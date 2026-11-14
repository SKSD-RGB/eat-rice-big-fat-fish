package com.xiaoman.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

public class SetupActivity extends Activity {

    public static final String PREF = "xiaoman";
    public static final String K_HOST = "host";
    public static final String K_PORT = "port";
    public static final String K_TOKEN = "token";

    // 默认值：留空，让用户自己填。这个文件要开源，绝不能把真实 IP / 口令写死在这里。
    public static final String DEF_HOST = "";
    public static final String DEF_PORT = "8787";
    public static final String DEF_TOKEN = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        SharedPreferences sp = getSharedPreferences(PREF, Context.MODE_PRIVATE);

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.parseColor("#EDEDED"));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(24), dp(48), dp(24), dp(24));
        scroll.addView(root);

        TextView title = new TextView(this);
        title.setText("连到电脑");
        title.setTextSize(24);
        title.setTextColor(Color.parseColor("#191919"));
        root.addView(title);

        TextView hint = new TextView(this);
        hint.setText("填电脑的地址、端口和口令。\n口令在项目目录的 data/token.txt 里。");
        hint.setTextSize(13);
        hint.setTextColor(Color.parseColor("#9A9A9A"));
        hint.setPadding(0, dp(8), 0, dp(24));
        root.addView(hint);

        EditText etHost = field(root, "电脑地址（例：192.168.1.100）", sp.getString(K_HOST, DEF_HOST), InputType.TYPE_CLASS_TEXT);
        EditText etPort = field(root, "端口（默认 8787）", sp.getString(K_PORT, DEF_PORT), InputType.TYPE_CLASS_NUMBER);
        EditText etToken = field(root, "口令（32 位）", sp.getString(K_TOKEN, DEF_TOKEN), InputType.TYPE_CLASS_TEXT);

        Button btn = new Button(this);
        btn.setText("连上她");
        btn.setTextSize(17);
        btn.setBackgroundColor(Color.parseColor("#07C160"));
        btn.setTextColor(Color.WHITE);
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        bp.topMargin = dp(20);
        btn.setLayoutParams(bp);
        root.addView(btn);

        TextView status = new TextView(this);
        status.setTextSize(13);
        status.setGravity(Gravity.CENTER);
        status.setPadding(0, dp(16), 0, 0);
        root.addView(status);

        btn.setOnClickListener(v -> {
            String host = etHost.getText().toString().trim();
            String port = etPort.getText().toString().trim();
            String token = etToken.getText().toString().trim();
            if (host.isEmpty() || token.isEmpty()) {
                status.setText("地址和口令都要填");
                return;
            }
            sp.edit().putString(K_HOST, host).putString(K_PORT, port).putString(K_TOKEN, token).apply();
            status.setText("正在连……");
            startService(new Intent(this, BridgeService.class));
            finish();
        });

        setContentView(scroll);
    }

    private EditText field(LinearLayout root, String hintText, String value, int inputType) {
        EditText e = new EditText(this);
        e.setHint(hintText);
        e.setText(value);
        e.setInputType(inputType);
        e.setTextSize(15);
        e.setPadding(dp(12), dp(12), dp(12), dp(12));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.topMargin = dp(10);
        e.setLayoutParams(p);
        root.addView(e);
        return e;
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density);
    }
}
