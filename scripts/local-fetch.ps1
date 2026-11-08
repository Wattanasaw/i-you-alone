# ดึงงานจากเครื่องตัวเอง แล้วขึ้น GitHub ให้อัตโนมัติ
# ใช้เพราะ Eventpop บล็อกเซิร์ฟเวอร์ของ GitHub (ตอบ 403) แต่เปิดจากเน็ตบ้านได้ปกติ
# ตั้งเวลาด้วย scripts/install-local-fetch.ps1 · ดูผลย้อนหลังที่ %LOCALAPPDATA%\IYouAlone\fetch.log
$ErrorActionPreference = "Continue"
# ให้อ่านข้อความภาษาไทยจาก node ถูก
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$repo = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $env:LOCALAPPDATA "IYouAlone"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir "fetch.log"
function Log($msg) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" | Out-File $log -Append -Encoding utf8 }

$git = "C:\Program Files\Git\cmd\git.exe"
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Log "ไม่พบ node — ข้ามรอบนี้"; exit 1 }
# ให้ git หา gh (ตัวช่วยล็อกอิน) เจอ
$env:PATH = "C:\Program Files\Git\cmd;C:\Program Files\GitHub CLI;$env:PATH"

# ทำงานในสำเนาแยก (%LOCALAPPDATA%\IYouAlone\repo) — ไฟล์ที่กำลังแก้ค้างในโฟลเดอร์โปรเจกต์จะไม่ทำให้รอบนี้ถูกข้าม
$work = Join-Path $logDir "repo"
Log "เริ่มดึงงาน"
if (-not (Test-Path (Join-Path $work ".git"))) {
  $origin = (& $git -C $repo remote get-url origin).Trim()
  & $git clone -q --depth 50 $origin $work 2>&1 | ForEach-Object { Log "git: $_" }
  if ($LASTEXITCODE -ne 0) { Log "clone ไม่สำเร็จ — ข้ามรอบนี้"; exit 1 }
}
Set-Location $work
& $git config user.name "Wattanasaw"
& $git config user.email "Wattanasaw@users.noreply.github.com"
# สำเนานี้ใช้ดึงงานอย่างเดียว → ล้างของค้างจากรอบก่อนแล้วตามให้ตรงกับบน GitHub
& $git fetch -q origin 2>&1 | ForEach-Object { Log "git: $_" }
if ($LASTEXITCODE -ne 0) { Log "fetch ไม่สำเร็จ (ยังไม่ต่อเน็ต?) — ข้ามรอบนี้"; exit 1 }
& $git reset -q --hard origin/main
& $git clean -q -fd data

# เก็บผลทั้งหมดก่อนแล้วค่อยตัด (ห้ามใช้ Select-Object -First กับ node ตรงๆ เพราะจะหยุด node กลางทาง)
$out = & $node scripts/fetch-events.mjs 2>&1
$fetchOk = $LASTEXITCODE -eq 0
$out | Where-Object { "$_" -match "ตอบ|เก็บ|เสีย" } | Select-Object -First 5 | ForEach-Object { Log "$_" }
# ใส่ผลตรวจ AI ที่ GitHub จำไว้ให้งานที่เพิ่งดึง (เครื่องนี้ไม่ถาม AI เอง ไม่เปลืองโควต้า)
$env:GEMINI_API_KEY = ""
& $node scripts/ai-review.mjs 2>&1 | Out-Null
& $node scripts/event-images.mjs 2>&1 | Out-Null  # ไม่มี AI ในเครื่อง = ใส่คะแนนรูปที่จำไว้
$out = & $node scripts/check-data.mjs 2>&1
$checkOk = $LASTEXITCODE -eq 0
$out | Select-Object -Last 1 | ForEach-Object { Log "$_" }
if (-not ($fetchOk -and $checkOk)) { Log "ข้อมูลไม่ผ่านการตรวจ — ไม่ขึ้นเว็บ"; & $git checkout -- data/auto-events.json data/geocache.json; exit 1 }

& $git add data/auto-events.json data/geocache.json data/event-images.json
& $git diff --cached --quiet
if ($LASTEXITCODE -eq 0) { Log "ไม่มีงานเปลี่ยน"; exit 0 }
& $git commit -q -m "อัปเดตงานอีเว้นท์จากเครื่อง (รวม Eventpop)"
# ถ้าบอทบน GitHub แก้ไฟล์เดียวกันพอดี ให้ใช้ของเครื่องนี้ (ข้อมูลครบกว่า เพราะมี Eventpop)
for ($i = 1; $i -le 3; $i++) {
  & $git pull -q --rebase -X theirs 2>&1 | ForEach-Object { Log "git: $_" }
  & $git push -q 2>&1 | ForEach-Object { Log "git: $_" }
  if ($LASTEXITCODE -eq 0) { Log "ขึ้นเว็บแล้ว"; exit 0 }
  Start-Sleep 30
}
Log "push ไม่สำเร็จ — จะลองใหม่รอบหน้า"
exit 1
