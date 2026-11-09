package io.github.wattanasaw.iyoualone;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * เปิดลิงก์ร้านค้า/Affiliate (Shopee, Lazada ฯลฯ) ในแอพของร้านนั้นโดยตรง
 * เดิมเปิดด้วย ACTION_VIEW ธรรมดา → เครื่องที่ยังไม่ยืนยัน App Links / ปิด "เปิดลิงก์ที่รองรับ" ไว้ จะไปเปิดหน้าเว็บแทน
 * ลำดับ: แอพร้านค้าที่ระบุ (ติดตั้งอยู่) → ให้ระบบเลือก (App Links) → แจ้งกลับว่าเปิดไม่ได้ (ฝั่งเว็บใช้เบราว์เซอร์แทน)
 */
@CapacitorPlugin(name = "StoreLink")
public class StoreLinkPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (url == null) { call.reject("Must provide a url"); return; }
        Uri uri = Uri.parse(url);
        JSObject ret = new JSObject();
        String[] pkgs = packagesFor(uri.getHost());
        for (String pkg : pkgs) {
            if (!installed(pkg)) continue;
            Intent i = new Intent(Intent.ACTION_VIEW, uri);
            i.setPackage(pkg);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getActivity().startActivity(i);
                ret.put("opened", "app");
                call.resolve(ret);
                return;
            } catch (Exception ignored) { }
        }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, uri);
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
            ret.put("opened", "system");
        } catch (Exception e) {
            ret.put("opened", "none");
        }
        call.resolve(ret);
    }

    private String[] packagesFor(String host) {
        if (host == null) return new String[0];
        host = host.toLowerCase();
        if (host.endsWith("shopee.co.th") || host.endsWith("shp.ee")) return new String[] { "com.shopee.th" };
        if (host.endsWith("lazada.co.th") || host.endsWith("lzd.co")) return new String[] { "com.lazada.android" };
        if (host.endsWith("tiktok.com")) return new String[] { "com.ss.android.ugc.trill", "com.zhiliaoapp.musically" };
        if (host.endsWith("lemon8-app.com")) return new String[] { "com.bd.nproject" };
        if (host.endsWith("trip.com")) return new String[] { "ctrip.english" };
        return new String[0];
    }

    private boolean installed(String pkg) {
        try {
            getContext().getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }
}
