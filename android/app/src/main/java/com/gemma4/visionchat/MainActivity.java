package com.gemma4.visionchat;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ClaudePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
