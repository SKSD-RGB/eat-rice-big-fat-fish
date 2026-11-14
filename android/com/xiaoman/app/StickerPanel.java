package com.xiaoman.app;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.GridLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

/**
 * 表情面板 —— 点一下就把那张表情发出去
 *
 * 设计：
 *   进来时先拉清单（/app/stickers），拿到每张的地址
 *   缩略图异步下载，下好一张画一张，不用等全部
 *   点一张 → 回调 onPick，由 MainActivity 负责真正发出去
 */
public class StickerPanel {

    public interface OnPick {
        void pick(String url, String name);
    }

    private final Context ctx;
    private final String host, port, token;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private LinearLayout root;
    private GridLayout grid;
    private TextView tip;

    private final List<ImageView> slots = new ArrayList<>();
    private boolean loaded = false;

    public StickerPanel(Context ctx, String host, String port, String token) {
        this.ctx = ctx;
        this.host = host;
        this.port = port;
        this.token = token;
        build();
    }

    public View getView() {
        return root;
    }

    private int dp(float v) {
        return (int) (v * ctx.getResources().getDisplayMetrics().density);
    }

    private void build() {
        root = new LinearLayout(ctx);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#F7F7F7"));
        root.setPadding(dp(8), dp(8), dp(8), dp(8));
        root.setVisibility(View.GONE);

        LinearLayout head = new LinearLayout(ctx);
        head.setOrientation(LinearLayout.HORIZONTAL);
        head.setGravity(Gravity.CENTER_VERTICAL);

        tip = new TextView(ctx);
        tip.setText("表情");
        tip.setTextSize(13);
        tip.setTextColor(Color.parseColor("#999999"));
        tip.setPadding(dp(4), 0, 0, dp(6));
        head.addView(tip, new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        TextView close = new TextView(ctx);
        close.setText("收起");
        close.setTextSize(13);
        close.setTextColor(Color.parseColor("#07C160"));
        close.setPadding(dp(10), dp(2), dp(10), dp(2));
        close.setOnClickListener(v -> hide());
        head.addView(close);

        root.addView(head);

        ScrollView sc = new ScrollView(ctx);
        sc.setFillViewport(true);
        grid = new GridLayout(ctx);
        grid.setColumnCount(5);
        sc.addView(grid);
        // 高度用 weight 撑满剩余空间，不留白
        root.addView(sc, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
    }

    public boolean isShowing() {
        return root.getVisibility() == View.VISIBLE;
    }

    /** 按键盘高度设置面板高度（微信那种：跟键盘占同一块） */
    public void setPanelHeight(int h) {
        if (h <= 0) h = dp(260);
        android.view.ViewGroup.LayoutParams lp = root.getLayoutParams();
        if (lp != null) {
            lp.height = h;
            root.setLayoutParams(lp);
        }
    }

    public void show() {
        root.setVisibility(View.VISIBLE);
        if (!loaded) load();
    }

    public void hide() {
        root.setVisibility(View.GONE);
    }

    public void toggle() {
        if (isShowing()) hide();
        else show();
    }

    // ---------- 拉清单 ----------
    private void load() {
        tip.setText("表情加载中…");
        new Thread(() -> {
            try {
                URL u = new URL("http://" + host + ":" + port + "/app/stickers");
                HttpURLConnection c = (HttpURLConnection) u.openConnection();
                c.setRequestProperty("authorization", "Bearer " + token);
                c.setConnectTimeout(8000);
                c.setReadTimeout(20000);
                BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"));
                StringBuilder sb = new StringBuilder();
                String l;
                while ((l = r.readLine()) != null) sb.append(l);
                r.close();
                c.disconnect();

                JSONObject j = new JSONObject(sb.toString());
                JSONArray arr = j.optJSONArray("gallery");
                if (arr == null) throw new Exception("没有表情清单");

                List<String[]> items = new ArrayList<>();
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.getJSONObject(i);
                    String url = o.optString("url");
                    String name = o.optString("name");
                    if (url.isEmpty()) continue;
                    if (url.startsWith("/")) url = "http://" + host + ":" + port + url;
                    items.add(new String[]{url, name});
                }
                loaded = true;
                ui.post(() -> render(items));
            } catch (Exception e) {
                final String m = e.getMessage();
                Log.w("XMMSG", "表情清单拉不到: " + m);
                ui.post(() -> tip.setText("表情加载失败：" + m));
            }
        }).start();
    }

    // ---------- 一张张画 ----------
    private void render(final List<String[]> items) {
        grid.removeAllViews();
        slots.clear();
        tip.setText(items.size() + " 个表情");

        // 按屏幕宽度算出每张多大 —— 一行正好放满，不留空
        int gap = dp(4);
        int cols = 5;   // 一行 5 个，跟参考图那种密度差不多
        int screenW = ctx.getResources().getDisplayMetrics().widthPixels;
        int padH = dp(8) * 2;                  // 面板左右内边距（跟 root 一致）
        int avail = screenW - padH - gap * 2 * cols;
        int side = Math.max(dp(48), avail / cols);

        for (final String[] it : items) {
            final ImageView iv = new ImageView(ctx);
            GridLayout.LayoutParams lp = new GridLayout.LayoutParams();
            lp.width = side;
            lp.height = side;
            lp.setMargins(gap, gap, gap, gap);
            iv.setLayoutParams(lp);
            iv.setScaleType(ImageView.ScaleType.FIT_CENTER);

            GradientDrawable g = new GradientDrawable();
            g.setCornerRadius(dp(6));
            g.setColor(Color.parseColor("#E6E6E6"));
            iv.setBackground(g);

            iv.setOnClickListener(v -> {
                if (picked) return;
                picked = true;
                if (listener != null) listener.pick(it[0], it[1]);
                hide();
                ui.postDelayed(() -> picked = false, 600);
            });

            grid.addView(iv);
            slots.add(iv);
            loadThumb(iv, it[0]);
        }
    }

    private boolean picked = false;
    private OnPick listener;

    public void setOnPick(OnPick l) {
        this.listener = l;
    }

    // 一次只下几张，免得把手机拖死
    private void loadThumb(final ImageView iv, final String url) {
        new Thread(() -> {
            try {
                final android.graphics.Bitmap bmp =
                        android.graphics.BitmapFactory.decodeStream(new URL(url).openStream());
                if (bmp != null) ui.post(() -> iv.setImageBitmap(bmp));
            } catch (Exception ignored) {
                // 这一张就算了，不打断
            }
        }).start();
    }
}
