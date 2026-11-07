-- ระบบสมาชิก I You Alone บน Supabase (แพ็กเกจฟรี)
-- วิธีใช้: Supabase → SQL Editor → วางไฟล์นี้ทั้งไฟล์ → Run (รันซ้ำได้ ไม่พัง)
-- ความปลอดภัย: เปิด Row Level Security ทุกตาราง — สมาชิกเห็น/แก้ได้เฉพาะข้อมูลของตัวเอง
--             ร้านที่ส่งเข้ามาจะถูกเผยแพร่ก็ต่อเมื่อ AI ตรวจผ่าน (สคริปต์ใน GitHub Actions ใช้ service key)

-- ---------- โปรไฟล์สมาชิก ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  account_type text not null default 'personal' check (account_type in ('personal', 'business')),
  display_name text check (char_length(display_name) <= 60),
  home_province text,
  interests text[] default '{}',          -- หมวดที่สนใจ (ใช้แนะนำงาน/ที่เที่ยว)
  car jsonb default '{}'::jsonb,           -- ตั้งค่ารถ {kmpl, fuel} สำหรับคำนวณค่าเดินทาง
  saved text[] default '{}',               -- งาน/ที่เที่ยวที่บันทึกไว้ (ซิงก์ข้ามเครื่อง)
  pdpa_consent_at timestamptz,             -- วันที่ยอมรับนโยบายความเป็นส่วนตัว
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.profiles enable row level security;
drop policy if exists "own profile read" on public.profiles;
drop policy if exists "own profile write" on public.profiles;
drop policy if exists "own profile update" on public.profiles;
create policy "own profile read" on public.profiles for select using (auth.uid() = id);
create policy "own profile write" on public.profiles for insert with check (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);

-- ---------- ร้านที่ธุรกิจส่งเข้ามา (รอ AI ตรวจ) ----------
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users on delete cascade default auth.uid(),
  kind text not null check (kind in ('restaurant', 'cafe', 'animalcafe', 'attraction')),
  name text not null check (char_length(name) between 2 and 80),
  description text check (char_length(description) <= 600),
  lat double precision not null check (lat between 5.5 and 20.6),     -- อยู่ในประเทศไทย
  lng double precision not null check (lng between 97.3 and 105.7),
  address text check (char_length(address) <= 200),
  province text,
  hours text check (char_length(hours) <= 120),
  phone text check (char_length(phone) <= 30),
  website text check (char_length(website) <= 200),
  photos text[] not null check (array_length(photos, 1) between 1 and 5), -- path ใน storage bucket "shop-photos"
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'needs_fix')),
  ai_result jsonb,                         -- ผลตรวจ AI (เหตุผล, คะแนน) ให้เจ้าของร้านเห็น
  reviewed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.submissions enable row level security;
drop policy if exists "own submissions read" on public.submissions;
drop policy if exists "business can submit" on public.submissions;
drop policy if exists "owner can fix" on public.submissions;
drop policy if exists "owner can delete" on public.submissions;
create policy "own submissions read" on public.submissions for select using (auth.uid() = owner);
-- ส่งได้เฉพาะบัญชีธุรกิจ และเริ่มที่สถานะรอตรวจเสมอ
create policy "business can submit" on public.submissions for insert with check (
  auth.uid() = owner and status = 'pending' and ai_result is null
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.account_type = 'business')
);
-- แก้ไขแล้วส่งตรวจใหม่ได้ (กลับเป็น pending) แต่แก้ผลตรวจเองไม่ได้
create policy "owner can fix" on public.submissions for update using (auth.uid() = owner)
  with check (auth.uid() = owner and status = 'pending' and ai_result is null);
create policy "owner can delete" on public.submissions for delete using (auth.uid() = owner);
-- จำกัดไม่ให้ส่งรัวๆ: ไม่เกิน 5 ร้านที่รอตรวจต่อบัญชี
create or replace function public.limit_pending() returns trigger language plpgsql as $$
begin
  if (select count(*) from public.submissions where owner = new.owner and status = 'pending') >= 5 then
    raise exception 'ส่งรอตรวจได้ไม่เกิน 5 ร้านพร้อมกัน';
  end if;
  return new;
end $$;
drop trigger if exists limit_pending on public.submissions;
create trigger limit_pending before insert on public.submissions for each row execute function public.limit_pending();

-- ---------- ที่เก็บรูปร้าน ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shop-photos', 'shop-photos', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
drop policy if exists "upload own folder" on storage.objects;
drop policy if exists "delete own photos" on storage.objects;
-- อัปโหลดได้เฉพาะโฟลเดอร์ของตัวเอง: shop-photos/<user id>/...
create policy "upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'shop-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "delete own photos" on storage.objects for delete to authenticated
  using (bucket_id = 'shop-photos' and (storage.foldername(name))[1] = auth.uid()::text);
