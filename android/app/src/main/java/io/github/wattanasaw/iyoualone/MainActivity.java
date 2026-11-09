package io.github.wattanasaw.iyoualone;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // ปลั๊กอินในแอพเอง: เปิดลิงก์ร้านค้า/Affiliate ในแอพร้านค้า (StoreLinkPlugin)
        registerPlugin(StoreLinkPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
