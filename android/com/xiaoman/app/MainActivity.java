package com.xiaoman.app;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends Activity {

    public static final String ACTION_NEW_MESSAGE = "com.xiaoman.app.NEW_MESSAGE";
    private static final String TAG = "XMMSG";
    private static final int REQ_PICK = 1001;

    // ---------- 状态 ----------
    private String host, port, token;
    private LinearLayout messages;
    private ScrollView scroll;
    private EditText input;
    private TextView statusBar;
    private TextView nameView;
    private TextView dotView;
    private TextView avatarView;
    private LinearLayout statusRow;
    private ChevronView btnStatusView;
    private boolean statusEnabled = true;   // 状态栏功能总开关（关掉=箭头和那一行都不出现）
    private JSONArray statusFields = null;  // 哪些字段要显示
    private android.widget.HorizontalScrollView statusScroll;
    private boolean statusOpen = false;
    private int skinIndex = 0;
    private SettingsDrawer drawer;
    private android.widget.FrameLayout rootFrame;
    private String herName = "小鲸";
    private String avatarPath = "";
    private String coverPath = "";   // 聊天背景封面，空 = 用主题色
    private String currentMsgId = "";

    private final Handler ui = new Handler(Looper.getMainLooper());
    private StickerPanel stickerPanel;

    /**
     * 唯一真相：这个 id 已经画进屏幕了吗。
     * 所有绘制都必须先过这里，过不去就什么都不做。
     * 只在 UI 线程读写，天然不会并发。
     */
    private final java.util.HashSet<String> drawnIds = new java.util.HashSet<>();

    /** 上一次显示分隔时间的位置（毫秒） */
    private long lastDividerAt = 0;

    /** 防止两个轮询同时跑 */
    private final AtomicBoolean polling = new AtomicBoolean(false);

    /** 历史拉完了没有——没拉完不许轮询，否则两边各画一遍 */
    private volatile boolean historyDone = false;

    // ---------- 生命周期 ----------
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        android.util.Log.i(TAG, "onCreate 开始");

        SharedPreferences sp = getSharedPreferences(SetupActivity.PREF, Context.MODE_PRIVATE);
        host = sp.getString(SetupActivity.K_HOST, SetupActivity.DEF_HOST);
        port = sp.getString(SetupActivity.K_PORT, SetupActivity.DEF_PORT);
        token = sp.getString(SetupActivity.K_TOKEN, SetupActivity.DEF_TOKEN);

        if (host.isEmpty() || token.isEmpty()) {
            startActivity(new Intent(this, SetupActivity.class));
            finish();
            return;
        }

        android.util.Log.i(TAG, "读到配置 host=" + host + " port=" + port + " token=" + (token.isEmpty() ? "空" : token.length() + "位"));
        buildUI();
        android.util.Log.i(TAG, "buildUI 完成");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                    != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 1);
            }
        }

        startService(new Intent(this, BridgeService.class));

        IntentFilter f = new IntentFilter(ACTION_NEW_MESSAGE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(receiver, f, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(receiver, f);
        }

        android.util.Log.i(TAG, "准备拉历史");
        checkOnline();
        loadAllHistory();
        android.util.Log.i(TAG, "onCreate 结束");
    }

    @Override
    protected void onResume() {
        super.onResume();
        ui.removeCallbacks(pollTask);
        ui.postDelayed(pollTask, 1500);
    }

    @Override
    protected void onPause() {
        super.onPause();
        ui.removeCallbacks(pollTask);
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacks(pollTask);
        try { unregisterReceiver(receiver); } catch (Exception ignored) {}
        super.onDestroy();
    }

    // ---------- 轮询 ----------
    private final Runnable pollTask = new Runnable() {
        @Override public void run() {
            checkOnline();
            pollNew();
            ui.postDelayed(this, 3000);
        }
    };

    // ---------- 界面 ----------
    private void buildUI() {
        Theme.init(this);
        // 读回上次的开关状态
        statusEnabled = true;   // 默认开着

        // 把上次换的头像、名字、封面都读回来
        SharedPreferences spInit = getSharedPreferences(SetupActivity.PREF, Context.MODE_PRIVATE);
        avatarPath = spInit.getString("avatar", "");
        if (avatarPath != null && !new java.io.File(avatarPath).exists()) avatarPath = "";

        String savedName = spInit.getString("her_name", "");
        if (savedName != null && !savedName.isEmpty()) herName = savedName;

        coverPath = spInit.getString("cover", "");
        if (coverPath != null && !new java.io.File(coverPath).exists()) coverPath = "";

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        // 背景：有封面图就铺图（盖一层薄雾让字看得清），没有就用主题色
        if (coverPath != null && !coverPath.isEmpty()) {
            java.io.File cf = new java.io.File(coverPath);
            if (cf.exists()) {
                android.graphics.drawable.BitmapDrawable bd =
                        new android.graphics.drawable.BitmapDrawable(
                                getResources(),
                                android.graphics.BitmapFactory.decodeFile(coverPath));
                bd.setGravity(android.view.Gravity.FILL);
                GradientDrawable veil = new GradientDrawable(
                        GradientDrawable.Orientation.TOP_BOTTOM,
                        Theme.dark ? new int[]{0x99101520, 0xBB0A0F18}
                                   : new int[]{0x55FFFFFF, 0x88FFFFFF});
                root.setBackground(new android.graphics.drawable.LayerDrawable(
                        new android.graphics.drawable.Drawable[]{bd, veil}));
            } else {
                root.setBackground(Theme.background());
            }
        } else {
            root.setBackground(Theme.background());
        }

        // ===== 顶栏 =====
        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setPadding(dp(14), dp(11), dp(10), dp(11));
        top.setBackgroundColor(Theme.bar());

        // 头像：有自定义图就用图，没有就鲸鱼
        View topAv = makeAvatar(dp(Theme.AVATAR_BIG), 0);
        LinearLayout.LayoutParams avp = new LinearLayout.LayoutParams(
                dp(Theme.AVATAR_BIG), dp(Theme.AVATAR_BIG));
        topAv.setLayoutParams(avp);
        top.addView(topAv);
        avatarView = new TextView(this);   // 留着给别处引用，不显示
        avatarView.setText("");

        // 名字 + 状态
        LinearLayout meta = new LinearLayout(this);
        meta.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams mp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        mp.leftMargin = dp(11);
        meta.setLayoutParams(mp);

        LinearLayout nameRow = new LinearLayout(this);
        nameRow.setOrientation(LinearLayout.HORIZONTAL);
        nameRow.setGravity(Gravity.CENTER_VERTICAL);

        nameView = new TextView(this);
        nameView.setText("小鲸");
        nameView.setTextSize(16);
        nameView.setTextColor(Theme.text());
        nameView.setTypeface(null, android.graphics.Typeface.BOLD);
        nameRow.addView(nameView);

        dotView = new TextView(this);
        dotView.setText("●");
        dotView.setTextSize(9);
        dotView.setTextColor(Theme.OFFLINE);
        LinearLayout.LayoutParams dp2 = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        dp2.leftMargin = dp(6);
        dotView.setLayoutParams(dp2);
        nameRow.addView(dotView);

        meta.addView(nameRow);

        statusBar = new TextView(this);
        statusBar.setText("连接中…");
        statusBar.setTextSize(11.5f);
        statusBar.setTextColor(Theme.muted());
        meta.addView(statusBar);

        top.addView(meta);

        // 刷新：重连 + 重拉历史
        TextView btnRefresh = new TextView(this);
        btnRefresh.setText("⟳");
        btnRefresh.setTextSize(19);
        btnRefresh.setGravity(Gravity.CENTER);
        btnRefresh.setTextColor(Theme.muted());
        GradientDrawable refreshBg = new GradientDrawable();
        refreshBg.setCornerRadius(dp(13));
        refreshBg.setColor(Theme.dark ? 0x1AFFFFFF : 0xFFEFF2F6);
        btnRefresh.setBackground(refreshBg);
        LinearLayout.LayoutParams rbp = new LinearLayout.LayoutParams(dp(38), dp(38));
        rbp.rightMargin = dp(6);
        btnRefresh.setLayoutParams(rbp);
        btnRefresh.setOnClickListener(v -> {
            toast("刷新中…");
            checkOnline();
            messages.removeAllViews();
            drawnIds.clear();
            lastDividerAt = 0;
            loadAllHistory();
            if (statusOpen) fetchStatus();
        });
        top.addView(btnRefresh);

        // 状态切换按钮
        btnStatusView = new ChevronView(this);
        btnStatusView.setColor(Theme.dark ? 0xFFE8ECF0 : 0xFF1A1A1A);
        btnStatusView.setUp(true);    // 默认朝上
        // 带底的圆角胶囊
        GradientDrawable statusBg = new GradientDrawable();
        statusBg.setShape(GradientDrawable.OVAL);   // 正圆
        statusBg.setColor(Theme.dark ? 0x1AFFFFFF : 0xFFF0F0F0);
        btnStatusView.setBackground(statusBg);
        LinearLayout.LayoutParams sbp = new LinearLayout.LayoutParams(dp(38), dp(38));
        sbp.rightMargin = dp(6);
        btnStatusView.setLayoutParams(sbp);
        btnStatusView.setOnClickListener(v -> toggleStatusRow());
        top.addView(btnStatusView);

        // 设置按钮
        TextView gear = new TextView(this);
        gear.setText("≡");
        gear.setTextSize(20);
        gear.setTextColor(Theme.muted());
        gear.setPadding(dp(10), dp(6), dp(6), dp(6));
        gear.setOnClickListener(v -> {
            if (drawer != null) drawer.show();
        });
        top.addView(gear);

        root.addView(top);

        // ===== 状态胶囊条（默认收起，横向可滑） =====
        statusRow = new LinearLayout(this);
        statusRow.setOrientation(LinearLayout.HORIZONTAL);
        statusRow.setPadding(dp(14), dp(8), dp(14), dp(9));

        statusScroll = new android.widget.HorizontalScrollView(this);
        statusScroll.setHorizontalScrollBarEnabled(false);
        statusScroll.setVisibility(View.GONE);
        statusScroll.addView(statusRow, new android.widget.FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(statusScroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // 这里先不调，等整个界面建完再统一刷（见 buildUI 结尾）

        // ===== 消息区 =====
        scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        messages = new LinearLayout(this);
        messages.setOrientation(LinearLayout.VERTICAL);
        messages.setPadding(dp(12), dp(14), dp(12), dp(8));
        scroll.addView(messages, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // ★ 点聊天区空白 = 收起键盘 + 收起表情（微信就是这样）
        // 不做任何判断，直接收 —— 收起是幂等的
        scroll.setOnTouchListener((v, ev) -> {
            if (ev.getAction() == android.view.MotionEvent.ACTION_UP) {
                dismissInputPanel();
            }
            return false;   // 不拦截，滚动照常
        });
        root.addView(scroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        // ===== 输入栏 =====
        LinearLayout bottom = new LinearLayout(this);
        bottom.setOrientation(LinearLayout.HORIZONTAL);
        bottom.setGravity(Gravity.CENTER_VERTICAL);
        bottom.setPadding(dp(10), dp(8), dp(10), dp(8));
        bottom.setBackgroundColor(Theme.bar());

        // 加号（发图）
        TextView plus = new TextView(this);
        plus.setText("＋");
        plus.setTextSize(20);
        plus.setGravity(Gravity.CENTER);
        plus.setTextColor(Theme.muted());
        plus.setBackground(Theme.roundRect(Theme.chipBg(), 0, 14));
        LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(dp(40), dp(40));
        pp.rightMargin = dp(8);
        plus.setLayoutParams(pp);
        plus.setOnClickListener(v -> pickImage());
        bottom.addView(plus);

        // 输入框
        input = new EditText(this);
        // ★ 点输入框 = 要用键盘：收掉表情 + 主动把键盘叫起来
        input.setOnClickListener(v -> {
            if (stickerPanel != null && stickerPanel.isShowing()) {
                stickerPanel.hide();
            }
            showKeyboard();
        });
        input.setOnFocusChangeListener((v, hasFocus) -> {
            if (hasFocus) {
                if (stickerPanel != null && stickerPanel.isShowing()) {
                    stickerPanel.hide();
                }
                showKeyboard();
            }
        });
        input.setHint("说点什么…");
        input.setHintTextColor(Theme.muted());
        input.setTextSize(15);
        input.setTextColor(Theme.text());
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        input.setMaxLines(4);
        input.setBackground(Theme.inputBg());
        input.setPadding(dp(14), dp(9), dp(14), dp(9));
        LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        ip.rightMargin = dp(8);
        bottom.addView(input, ip);

        // 表情
        TextView emoji = new TextView(this);
        emoji.setText("☺");
        emoji.setTextSize(21);
        emoji.setGravity(Gravity.CENTER);
        emoji.setTextColor(Theme.muted());
        emoji.setBackground(Theme.roundRect(Theme.chipBg(), 0, 14));
        LinearLayout.LayoutParams ep = new LinearLayout.LayoutParams(dp(40), dp(40));
        ep.rightMargin = dp(8);
        emoji.setLayoutParams(ep);
        emoji.setOnClickListener(v -> {
            if (stickerPanel != null) {
                if (stickerPanel.isShowing()) {
                    stickerPanel.hide();
                } else {
                    // 微信那样：键盘收起 → 表情占同一块高度
                    hideKeyboard();
                    int h = lastKeyboardHeight > 0
                            ? lastKeyboardHeight
                            : (int) (getResources().getDisplayMetrics().heightPixels * 0.42f);
                    stickerPanel.setPanelHeight(h);
                    stickerPanel.show();
                    scrollDown();
                }
            }
        });
        bottom.addView(emoji);

        // 发送
        TextView send = new TextView(this);
        send.setText("↑");
        send.setTextSize(18);
        send.setGravity(Gravity.CENTER);
        send.setTextColor(Color.WHITE);
        send.setBackground(Theme.sendButton());
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(dp(42), dp(42));
        send.setLayoutParams(bp);
        send.setOnClickListener(v -> doSend());
        bottom.addView(send);

        root.addView(bottom);

        // 界面建完了，按开关状态刷一次可见性
        applyStatusBarVisible();

        // 监听软键盘高度（微信那种：表情面板占同一块）
        installKeyboardWatcher();

        // 表情面板（默认收起）
        stickerPanel = new StickerPanel(this, host, port, token);
        stickerPanel.setOnPick((url, name) -> sendSticker(url));
        root.addView(stickerPanel.getView());

        // 用 FrameLayout 包一层，好把设置抽屉盖在上面
        rootFrame = new android.widget.FrameLayout(this);
        rootFrame.addView(root, new android.widget.FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        drawer = new SettingsDrawer(this, drawerHost);
        rootFrame.addView(drawer.getView(), new android.widget.FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(rootFrame);

        // root 保持 MATCH_PARENT，交给系统的 adjustResize 处理
        // （之前手动改 root 高度会把输入栏挤出屏幕，已回滚）

        // 恢复上次的皮肤
        SharedPreferences sp = getSharedPreferences(SetupActivity.PREF, Context.MODE_PRIVATE);
        skinIndex = sp.getInt("skin", 0);
    }

    // ---------- 状态胶囊 ----------
    private void toggleStatusRow() {
        android.util.Log.i("XJ", "toggleStatusRow 被点了, 之前 statusOpen=" + statusOpen);
        statusOpen = !statusOpen;
        if (btnStatusView != null) btnStatusView.setDown(statusOpen);
        applyStatusBarVisible();          // 统一由它决定显示还是藏
        if (statusOpen) loadStatusFields(this::fetchStatus);
    }

    /** 从 /app/status 拉状态，铺成胶囊 */
    private void fetchStatus() {
        new Thread(() -> {
            try {
                URL u = new URL("http://" + host + ":" + port + "/app/status");
                HttpURLConnection c = (HttpURLConnection) u.openConnection();
                c.setRequestMethod("GET");
                c.setRequestProperty("authorization", "Bearer " + token);
                c.setConnectTimeout(5000);
                c.setReadTimeout(8000);
                final String s = readAll(c);
                c.disconnect();
                final JSONObject j = new JSONObject(s);
                ui.post(() -> {
                    if (statusFields == null) {
                        // 第一次还没拿到字段设置，先拉一次再画
                        loadStatusFields(() -> renderStatus(j));
                    } else {
                        renderStatus(j);
                    }
                });
            } catch (Exception e) {
                android.util.Log.i(TAG, "status 拉不到: " + e.getMessage());
            }
        }).start();
    }

    private JSONObject lastStatus;   // 缓存，切开关时不用重新拉

    private void renderStatus(JSONObject j) {
        android.util.Log.i("XJ", "renderStatus 进来, ok=" + (j != null && j.optBoolean("ok"))
                + " row=" + (statusRow != null));
        if (j == null || !j.optBoolean("ok")) return;
        lastStatus = j;

        if (statusRow == null) return;
        statusRow.removeAllViews();   // 清空重画（不再被总开关阻断）

        JSONObject she = j.optJSONObject("she");
        JSONObject bridge = j.optJSONObject("bridge");

        android.util.Log.i("XJ", "字段: miss=" + isFieldOn("miss")
                + " memo=" + isFieldOn("memo") + " dev=" + isFieldOn("dev")
                + " she=" + (she != null) + " bridge=" + (bridge != null)
                + " fields=" + (statusFields == null ? "null" : statusFields.toString()));

        // 心情
        if (she != null && isFieldOn("miss")) {
            String mood = she.optString("mood", "");
            if (!mood.isEmpty()) addChip("心情", mood, true);
        }

        // 想你：取 axes 里最大的那个
        if (she != null && isFieldOn("miss")) {
            JSONObject axes = she.optJSONObject("axes");
            if (axes != null) {
                String k1 = null;
                double v1 = -1;
                java.util.Iterator<String> it = axes.keys();
                while (it.hasNext()) {
                    String k = it.next();
                    double v = axes.optDouble(k, 0);
                    if (v > 1.0) v = v / 100.0;
                    if (v > v1) { v1 = v; k1 = k; }
                }
                if (k1 != null && v1 > 0.20) addChip(axisCn(k1), pct(v1), false);
            }
        }

        // 记得
        if (she != null && isFieldOn("memo")) {
            int mem = she.optInt("memories", 0);
            if (mem > 0) addChip("记得", mem + " 条", false);
        }

        // 连着
        if (bridge != null && isFieldOn("dev")) {
            int cl = bridge.optInt("clients", 0);
            if (cl > 0) addChip("连着", cl + " 台", false);
        }
    }

    /** 某个状态字段是不是打开着 */
    private boolean isFieldOn(String key) {
        if (statusFields == null) {
            android.util.Log.i("XJ", "isFieldOn(" + key + ") -> statusFields 是 null，默认 true");
            return true;
        }   // 还没拉到设置，默认都显示
        for (int i = 0; i < statusFields.length(); i++) {
            JSONObject f = statusFields.optJSONObject(i);
            if (f != null && key.equals(f.optString("key"))) {
                return f.optBoolean("on", true);
            }
        }
        return true;
    }

    /** 拉一次状态字段设置 */
    private void loadStatusFields(final Runnable after) {
        new Thread(() -> {
            try {
                URL u = new URL("http://" + host + ":" + port + "/app/statusfields");
                HttpURLConnection c = (HttpURLConnection) u.openConnection();
                c.setRequestProperty("authorization", "Bearer " + token);
                c.setConnectTimeout(6000);
                c.setReadTimeout(9000);
                final String s = readAll(c);
                c.disconnect();
                ui.post(() -> {
                    try { statusFields = new JSONObject(s).optJSONArray("fields"); } catch (Exception ignored) {}
                    if (after != null) after.run();
                });
            } catch (Exception e) {
                ui.post(() -> { if (after != null) after.run(); });
            }
        }).start();
    }

    private void addChip(String key, String val, boolean warm) {
        TextView chip = new TextView(this);
        chip.setText(key + "  " + val);
        chip.setTextSize(11.5f);
        chip.setTextColor(Theme.text());
        chip.setPadding(dp(11), dp(5), dp(11), dp(5));

        int bg = warm
                ? 0xFFFFE0E4
                : Theme.chipBg();
        chip.setBackground(Theme.pill(bg));

        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.rightMargin = dp(7);
        chip.setLayoutParams(lp);
        statusRow.addView(chip);
    }

    private String pct(double v) {
        if (v <= 0) return "0%";
        int p = (int) Math.round(v * 100);
        if (p > 100) p = 100;
        return p + "%";
    }

    private String axisCn(String k) {
        switch (k) {
            case "joy": return "开心";
            case "trust": return "信任";
            case "fear": return "怕";
            case "surprise": return "意外";
            case "sadness": return "低落";
            case "disgust": return "腻";
            case "anger": return "气";
            case "anticipation": return "期待";
            case "intimacy": return "亲近";
            case "missing": return "想你";
            case "arousal": return "心动";
            case "clingy": return "黏人";
            case "happy": return "高兴";
            case "shy": return "害羞";
            case "lonely": return "想人";
            case "tired": return "累";
            case "jealous": return "吃醋";
            case "curious": return "好奇";
            case "guilty": return "愧疚";
            case "calm": return "平静";
            case "warm": return "暖";
            default: return k;
        }
    }

    // ---------- 发消息 ----------
    private void doSend() {

        final String text = input.getText().toString().trim();
        if (text.isEmpty()) return;
        input.setText("");
        postText("/app/send", text, false);
    }

    private void pickImage() {
        Intent i = new Intent(Intent.ACTION_GET_CONTENT);
        i.setType("image/*");
        i.addCategory(Intent.CATEGORY_OPENABLE);
        try {
            startActivityForResult(Intent.createChooser(i, "选张图"), REQ_PICK);
        } catch (Exception e) {
            toast("打不开相册：" + e.getMessage());
        }
    }

    @Override
    protected void onActivityResult(int req, int code, Intent data) {
        super.onActivityResult(req, code, data);
        if (code != RESULT_OK || data == null || data.getData() == null) return;

        // 换封面
        if (req == 2003) {
            try {
                InputStream in = getContentResolver().openInputStream(data.getData());
                java.io.File f = new java.io.File(getFilesDir(), "cover.jpg");
                java.io.FileOutputStream fo = new java.io.FileOutputStream(f);
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) fo.write(buf, 0, n);
                in.close();
                fo.close();
                coverPath = f.getAbsolutePath();
                getSharedPreferences(SetupActivity.PREF, Context.MODE_PRIVATE)
                        .edit().putString("cover", coverPath).apply();
                rebuildUI();
                toast("封面换好了");
            } catch (Exception e) {
                toast("存不下：" + e.getMessage());
            }
            return;
        }

        // 换头像
        if (req == 2002) {
            try {
                InputStream in = getContentResolver().openInputStream(data.getData());
                java.io.File f = new java.io.File(getFilesDir(), "avatar.png");
                java.io.FileOutputStream fo = new java.io.FileOutputStream(f);
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) fo.write(buf, 0, n);
                in.close();
                fo.close();
                avatarPath = f.getAbsolutePath();
                getSharedPreferences(SetupActivity.PREF, Context.MODE_PRIVATE)
                        .edit().putString("avatar", avatarPath).apply();
                // 整块重建界面（顶栏头像和消息头像一起换）
                rebuildUI();
                toast("头像换好了");
            } catch (Exception e) {
                toast("存不下：" + e.getMessage());
            }
            return;
        }

        if (req != REQ_PICK) return;
        toast("正在发…");
        final android.net.Uri uri = data.getData();
        new Thread(() -> uploadImage(uri)).start();
    }

    private void postText(String path, String text, boolean withImage) {
        new Thread(() -> {
            try {
                URL u = new URL("http://" + host + ":" + port + path);
                HttpURLConnection c = (HttpURLConnection) u.openConnection();
                c.setRequestMethod("POST");
                c.setRequestProperty("authorization", "Bearer " + token);
                c.setRequestProperty("content-type", "application/json");
                c.setDoOutput(true);
                c.setConnectTimeout(10000);
                c.setReadTimeout(120000);
                JSONObject body = new JSONObject().put("text", text);
                OutputStream os = c.getOutputStream();
                os.write(body.toString().getBytes("UTF-8"));
                os.close();
                int code = c.getResponseCode();
                c.disconnect();
                // 不在本地画，统一等轮询拉回来（只有一条来源）
                ui.post(MainActivity.this::pollNew);
                if (code != 200) ui.post(() -> toast("没发出去（" + code + "）"));
            } catch (Exception e) {
                final String msg = e.getMessage();
                ui.post(() -> toast("没发出去：" + msg));
            }
        }).start();
    }

    private void uploadImage(android.net.Uri uri) {
        try {
            InputStream in = getContentResolver().openInputStream(uri);
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            in.close();
            byte[] bytes = bo.toByteArray();

            String mime = getContentResolver().getType(uri);
            if (mime == null || !mime.startsWith("image/")) mime = "image/jpeg";

            if (bytes.length > 3 * 1024 * 1024) {
                android.graphics.Bitmap bmp = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                float r = Math.min(1f, 1600f / Math.max(bmp.getWidth(), bmp.getHeight()));
                android.graphics.Bitmap small = android.graphics.Bitmap.createScaledBitmap(bmp,
                        (int) (bmp.getWidth() * r), (int) (bmp.getHeight() * r), true);
                java.io.ByteArrayOutputStream so = new java.io.ByteArrayOutputStream();
                small.compress(android.graphics.Bitmap.CompressFormat.JPEG, 88, so);
                bytes = so.toByteArray();
                mime = "image/jpeg";
            }
            String b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);

            URL u = new URL("http://" + host + ":" + port + "/app/image");
            HttpURLConnection c = (HttpURLConnection) u.openConnection();
            c.setRequestMethod("POST");
            c.setRequestProperty("authorization", "Bearer " + token);
            c.setRequestProperty("content-type", "application/json");
            c.setDoOutput(true);
            c.setConnectTimeout(15000);
            c.setReadTimeout(180000);
            JSONObject body = new JSONObject().put("data", b64).put("mime", mime);
            OutputStream os = c.getOutputStream();
            os.write(body.toString().getBytes("UTF-8"));
            os.close();
            int code = c.getResponseCode();
            c.disconnect();

            ui.post(MainActivity.this::pollNew);
            if (code != 200) ui.post(() -> toast("图片没发出去（" + code + "）"));
        } catch (Exception e) {
            final String msg = e.getMessage();
            ui.post(() -> toast("图片没发出去：" + msg));
        }
    }

    // ---------- 发表情 ----------
    private void sendSticker(String imgUrl) {
        // 服务器那条记录存成 ![表情](地址)，发过去就完事
        String rel = imgUrl;
        String prefix = "http://" + host + ":" + port;
        if (rel.startsWith(prefix)) rel = rel.substring(prefix.length());
        final String msg = "![表情](" + rel + ")";
        new Thread(() -> {
            try {
                URL u = new URL("http://" + host + ":" + port + "/app/send");
                HttpURLConnection c = (HttpURLConnection) u.openConnection();
                c.setRequestMethod("POST");
                c.setRequestProperty("authorization", "Bearer " + token);
                c.setRequestProperty("content-type", "application/json");
                c.setDoOutput(true);
                c.setConnectTimeout(10000);
                c.setReadTimeout(120000);
                JSONObject body = new JSONObject().put("text", msg);
                java.io.OutputStream os = c.getOutputStream();
                os.write(body.toString().getBytes("UTF-8"));
                os.close();
                int code = c.getResponseCode();
                c.disconnect();
                ui.post(MainActivity.this::pollNew);
                if (code != 200) ui.post(() -> toast("表情没发出去（" + code + "）"));
            } catch (Exception e) {
                final String m = e.getMessage();
                ui.post(() -> toast("表情没发出去：" + m));
            }
        }).start();
    }

    // ---------- 拉消息 ----------
    /** 全量重画（进入程序 / 点刷新） */
    private void loadAllHistory() {
        android.util.Log.i(TAG, "loadAllHistory 开始");
        historyDone = false;
        new Thread(() -> {
            try {
                URL u = new URL("http://" + host + ":" + port + "/app/history?limit=80");
                HttpURLConnection c = (HttpURLConnection) u.openConnection();
                c.setRequestProperty("authorization", "Bearer " + token);
                c.setConnectTimeout(8000);
                c.setReadTimeout(20000);
                String s = readAll(c);
                c.disconnect();

                JSONArray arr = new JSONObject(s).optJSONArray("messages");
                if (arr == null) arr = new JSONArray();

                final List<Msg> list = new ArrayList<>();
                for (int i = 0; i < arr.length(); i++) list.add(Msg.from(arr.getJSONObject(i)));

                ui.post(() -> {
                    // 清屏 + 清账本，然后一次性重画
                    messages.removeAllViews();
                    drawnIds.clear();
                    lastDividerAt = 0;
                    for (Msg m : list) drawIfNew(m);
                    historyDone = true;
                });
            } catch (Exception e) {
                final String msg = e.getMessage();
                ui.post(() -> {
                    historyDone = true;   // 失败也放行，别把轮询卡死
                    Log.w("拉历史失败: " + msg);
                    toast("拉历史失败：" + msg);
                });
            }
        }).start();
    }

    /** 只拉最新几条，把没见过的补上 */
    private void pollNew() {
        if (!historyDone) {
            Log.i("poll 跳过：历史还没拉完");
            return;
        }
        if (!polling.compareAndSet(false, true)) return;
        new Thread(() -> {
            try {
                URL u = new URL("http://" + host + ":" + port + "/app/history?limit=10");
                HttpURLConnection c = (HttpURLConnection) u.openConnection();
                c.setRequestProperty("authorization", "Bearer " + token);
                c.setConnectTimeout(6000);
                c.setReadTimeout(12000);
                String s = readAll(c);
                c.disconnect();

                JSONArray arr = new JSONObject(s).optJSONArray("messages");
                if (arr == null) arr = new JSONArray();
                final List<Msg> list = new ArrayList<>();
                for (int i = 0; i < arr.length(); i++) list.add(Msg.from(arr.getJSONObject(i)));

                ui.post(() -> {
                    for (Msg m : list) drawIfNew(m);
                });
            } catch (Exception ignored) {
            } finally {
                polling.set(false);
            }
        }).start();
    }

    private String readAll(HttpURLConnection c) throws Exception {
        BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"));
        StringBuilder sb = new StringBuilder();
        String l;
        while ((l = r.readLine()) != null) sb.append(l);
        r.close();
        return sb.toString();
    }

    // ---------- 绘制（唯一入口） ----------
    /** 这条消息画过没有？没画过就画，画过就什么都不做。只在 UI 线程调用。 */
    private void drawIfNew(Msg m) {
        if (m == null || m.id == null || m.id.isEmpty()) return;
        if (!drawnIds.add(m.id)) return;        // ← 核心：add 返回 false 就是画过了
        currentMsgId = m.id;
        Log.i("draw id=" + m.id + " " + (m.mine ? "我" : "她") + " text=" + brief(m.text));

        if (m.at > 0) drawDividerIfNeeded(m.at);

        // 一行一行拆：图放图，字放气泡
        for (String line : m.text.split("\n")) {
            String s = line.trim();
            if (s.isEmpty()) continue;
            String img = extractImageUrl(s);
            if (img != null) {
                drawImage(img, m.mine);
            } else {
                drawText(s, m.mine);
            }
        }
        scrollDown();
    }

    private String extractImageUrl(String line) {
        if (!line.startsWith("![")) return null;
        int close = line.indexOf("](");
        if (close < 0) return null;
        int end = line.indexOf(")", close + 2);
        if (end < 0) return null;
        String url = line.substring(close + 2, end);
        if (url.startsWith("/")) return "http://" + host + ":" + port + url;
        if (url.startsWith("http")) return url;
        return "http://" + host + ":" + port + "/" + url;
    }

    private void drawDividerIfNeeded(long at) {
        if (lastDividerAt > 0 && at - lastDividerAt < 60 * 1000) return;
        lastDividerAt = at;

        java.util.Calendar cd = java.util.Calendar.getInstance();
        cd.setTimeInMillis(at);
        java.util.Calendar now = java.util.Calendar.getInstance();
        String hm = String.format("%02d:%02d",
                cd.get(java.util.Calendar.HOUR_OF_DAY), cd.get(java.util.Calendar.MINUTE));
        String label = (cd.get(java.util.Calendar.YEAR) == now.get(java.util.Calendar.YEAR)
                && cd.get(java.util.Calendar.DAY_OF_YEAR) == now.get(java.util.Calendar.DAY_OF_YEAR))
                ? hm
                : (cd.get(java.util.Calendar.MONTH) + 1) + "月" + cd.get(java.util.Calendar.DAY_OF_MONTH) + "日 " + hm;

        TextView tv = new TextView(this);
        tv.setText(label);
        tv.setTextSize(11);
        tv.setTextColor(Theme.muted());
        tv.setGravity(Gravity.CENTER);
        tv.setPadding(dp(10), dp(4), dp(10), dp(4));
        tv.setBackground(Theme.pill(Theme.chipBg()));

        LinearLayout wrap = new LinearLayout(this);
        wrap.setOrientation(LinearLayout.HORIZONTAL);
        wrap.setGravity(Gravity.CENTER);
        wrap.setPadding(0, dp(9), 0, dp(5));
        wrap.addView(tv);

        messages.addView(wrap, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }


    // ==================== 设置抽屉 ====================
    private final SettingsDrawer.Host drawerHost = new SettingsDrawer.Host() {
        @Override public String getHost() { return host; }
        @Override public String getPort() { return port; }
        @Override public String getToken() { return token; }
        @Override public String getHerName() { return herName; }

        @Override public void setHerName(String n) {
            herName = n;
            if (nameView != null) nameView.setText(n);
            getSharedPreferences(SetupActivity.PREF, Context.MODE_PRIVATE)
                    .edit().putString("her_name", n).apply();
        }

        @Override public int getSkin() { return skinIndex; }

        @Override public void setSkin(int idx) {
            skinIndex = idx;
            getSharedPreferences(SetupActivity.PREF, Context.MODE_PRIVATE)
                    .edit().putInt("skin", idx).apply();
            // 重画已有气泡（简单做法：重新拉历史）
            messages.removeAllViews();
            drawnIds.clear();
            lastDividerAt = 0;
            loadAllHistory();
            toast("换成" + Theme.SKIN_NAMES[idx]);
        }

        @Override public void onChangeAvatar() { pickAvatar(); }
        @Override public void onCover() { pickCover(); }

        @Override public void onClearChat() {
            MDialog.card(MainActivity.this, "清空聊天记录？",
                    "屏幕上的记录会没，但她记住的东西不丢。",
                    "清空", () -> doClearChat(), "算了", null).show();
        }

        @Override public void onExportChat() { doExport(); }
        @Override public void onTokenStats() { showTokenStats(); }
        @Override public void onSchedule() { showScheduleDialog(); }

        @Override public void onPersona() {
            MDialog.sheet(MainActivity.this, "换人格",
                    new String[]{"小鲸（完整，20k 字）", "小鲸（精简，省 token）"},
                    i -> {
                        String f = i == 0 ? "xiaoman_full.md" : "xiaoman_lite.md";
                        apiPost("/app/persona", "{\"file\":\"" + f + "\"}",
                                r -> toast(r.contains("\"ok\":true") ? "人格换好了" : "换失败：" + r));
                    }).show();
        }

        @Override public void onAiConfig() { showAiConfig(); }
        @Override public void onTheme() { showThemePicker(); }
        @Override public void onStatusToggle() { toggleStatusBar(); }
        @Override public void onStatusFields() { showStatusFields(); }
        @Override public void onMemories() { showMemories(); }
        @Override public void onAnalyze() { doAnalyze(); }
        @Override public void onChatBg() { showChatBg(); }
        @Override public boolean isStatusOn() { return statusEnabled; }

        @Override public void onKeys() { showKeysDialog(); }

        @Override public void onClose() {}
    };

    // ---------- 通用 POST ----------
    private void apiPost(final String path, final String json, final java.util.function.Consumer<String> cb) {
        new Thread(() -> {
            try {
                URL u = new URL("http://" + host + ":" + port + path);
                HttpURLConnection c = (HttpURLConnection) u.openConnection();
                c.setRequestMethod("POST");
                c.setRequestProperty("authorization", "Bearer " + token);
                c.setRequestProperty("content-type", "application/json");
                c.setDoOutput(true);
                c.setConnectTimeout(10000);
                c.setReadTimeout(120000);
                OutputStream os = c.getOutputStream();
                os.write(json.getBytes("UTF-8"));
                os.close();
                final String s = readAll(c);
                c.disconnect();
                ui.post(() -> { if (cb != null) cb.accept(s); });
            } catch (Exception e) {
                final String m = e.getMessage();
                ui.post(() -> { if (cb != null) cb.accept("{\"error\":\"" + m + "\"}"); });
            }
        }).start();
    }

    // ---------- 清空聊天 ----------
    private void doClearChat() {
        apiPost("/app/clear", "{}", r -> {
            messages.removeAllViews();
            drawnIds.clear();
            lastDividerAt = 0;
            toast("清空了");
        });
    }

    // ---------- 导出 ----------
    private void doExport() {
        new Thread(() -> {
            try {
                URL u = new URL("http://" + host + ":" + port + "/app/export?token=" + token);
                HttpURLConnection c = (HttpURLConnection) u.openConnection();
                c.setConnectTimeout(10000);
                c.setReadTimeout(30000);
                InputStream in = c.getInputStream();
                java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                in.close();
                c.disconnect();
                final byte[] data = bo.toByteArray();

                final java.io.File f = new java.io.File(
                        android.os.Environment.getExternalStorageDirectory(),
                        "xiaojing-chat-" + new java.text.SimpleDateFormat("yyyyMMdd-HHmm",
                                java.util.Locale.CHINA).format(new java.util.Date()) + ".txt");
                // 先存到 App 自己的外部目录（不用权限）
                final java.io.File dir = getExternalFilesDir(null);
                final java.io.File out = new java.io.File(dir, f.getName());
                java.io.FileOutputStream fo = new java.io.FileOutputStream(out);
                fo.write(data);
                fo.close();

                ui.post(() -> MDialog.card(MainActivity.this, "导出好了",
                        "文件在：\n" + out.getAbsolutePath(),
                        "好", null, null, null).show());
            } catch (Exception e) {
                final String m = e.getMessage();
                ui.post(() -> toast("导出失败：" + m));
            }
        }).start();
    }

    // ---------- Token 统计 ----------
    // ==================== 设置里那 7 样（2026-11-14 晚） ====================

    private SettingsFeatures feat() {
        return new SettingsFeatures(this, host, port, token, () -> checkOnline());
    }

    private void showAiConfig()     { feat().showAiConfig(); }
    private void showThemePicker() {
        SettingsFeatures f = feat();
        f.setOnThemeChanged(this::rebuildUI);      // 选完立刻重画整个界面
        f.showThemePicker();
    }
    private void showStatusFields() {
        SettingsFeatures f = feat();
        if (drawer != null) f.setPageHost(drawer);
        // 点开关 → 本地立刻改 + 立刻重画，存盘扔后台
        f.setOnStatusChanged((key, on) -> {
            applyFieldLocally(key, on);          // ① 本地那个数组当场改掉
            // ② 先把状态栏展开，不然改了也看不见
            if (!statusOpen) {
                statusOpen = true;
                statusScroll.setVisibility(View.VISIBLE);
                if (btnStatusView != null) btnStatusView.setDown(true);
            }
            // ③ 当场重画，不等网络
            if (lastStatus != null) {
                renderStatus(lastStatus);
            } else {
                fetchStatus();
            }
            toast(key + (on ? " 显示" : " 隐藏"));
        });
        f.showStatusFieldsPage();
    }

    /** 本地改一个开关（不动网络，立即生效） */
    private void applyFieldLocally(String key, boolean on) {
        try {
            if (statusFields == null) {
                // 还没拉到，先按默认三样造一个
                statusFields = new JSONArray();
                statusFields.put(new JSONObject().put("key", "miss").put("label", "想你").put("on", !"miss".equals(key) || on));
                statusFields.put(new JSONObject().put("key", "memo").put("label", "记得").put("on", !"memo".equals(key) || on));
                statusFields.put(new JSONObject().put("key", "dev").put("label", "连着").put("on", !"dev".equals(key) || on));
                return;
            }
            for (int i = 0; i < statusFields.length(); i++) {
                JSONObject f = statusFields.optJSONObject(i);
                if (f != null && key.equals(f.optString("key"))) {
                    f.put("on", on);
                    return;
                }
            }
            // 没有这个 key，补一条
            statusFields.put(new JSONObject().put("key", key).put("label", key).put("on", on));
        } catch (Exception ignored) {}
    }
    private void showMemories()     { feat().showMemories(); }
    private void doAnalyze()        { feat().doAnalyze(); }
    private void showChatBg() {
        SettingsFeatures f = feat();
        f.setOnThemeChanged(this::rebuildUI);
        f.showChatBg();
    }

    /** 把界面整个重建一遍（主题、背景这类改动要用） */
    private void rebuildUI() {
        try {
            // 记住现在滚到哪、抽屉开没开
            DrawerState st = new DrawerState();
            st.wasOpen = drawer != null && drawer.isShown();

            // 把当前界面（rootFrame 的第 0 个子 View）整块换掉
            if (rootFrame != null && rootFrame.getChildCount() > 0) {
                android.view.View old = rootFrame.getChildAt(0);
                if (drawer == null || old != drawer.getView()) rootFrame.removeView(old);
            }
            buildUI();

            // 抽屉重建
            if (drawer != null) {
                rootFrame.removeView(drawer.getView());
            }
            drawer = new SettingsDrawer(this, drawerHost);
            rootFrame.addView(drawer.getView());

            // 重新拉历史
            loadAllHistory();
            checkOnline();

            if (st.wasOpen) drawer.show();
        } catch (Exception e) {
            toast("重画失败：" + e.getMessage());
        }
    }

    private static class DrawerState { boolean wasOpen; }

    /** 状态栏那一行显不显示 */
    /** 「状态栏」开关：管顶栏那个箭头按钮显不显示（连带那一行） */
    private void toggleStatusBar() {
        statusEnabled = !statusEnabled;
        if (btnStatusView != null) {
            btnStatusView.setVisibility(statusEnabled ? View.VISIBLE : View.GONE);
            btnStatusView.setDown(statusEnabled && statusOpen);
        }
        if (statusScroll != null && !statusEnabled) {
            statusScroll.setVisibility(View.GONE);
            statusOpen = false;
        }
        SharedPreferences sp = getSharedPreferences("xiaoman", MODE_PRIVATE);
        sp.edit().putBoolean("statusBarOn", statusEnabled).apply();   // key 保持兼容，老数据不丢
        toast(statusEnabled ? "状态栏开关打开了" : "状态栏开关关掉了");
    }

    /** 按「总开关 + 展开状态」决定整条状态行和箭头按钮的可见性 */
    private void applyStatusBarVisible() {
        android.util.Log.i("XJ", "applyStatusBarVisible: statusOpen=" + statusOpen
                + " scroll=" + (statusScroll != null)
                + " row=" + (statusRow != null)
                + " btn=" + (btnStatusView != null));
        // 总开关关掉 = 箭头和整行都不出现
        if (statusScroll != null) {
            statusScroll.setVisibility((statusEnabled && statusOpen) ? View.VISIBLE : View.GONE);
        }
        if (statusRow != null) {
            statusRow.setVisibility(View.VISIBLE);
        }
        if (btnStatusView != null) {
            btnStatusView.setVisibility(statusEnabled ? View.VISIBLE : View.GONE);
        }
    }

    private void showTokenStats() {
        new Thread(() -> {
            try {
                URL u = new URL("http://" + host + ":" + port + "/app/usage?token=" + token);
                HttpURLConnection c = (HttpURLConnection) u.openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(12000);
                final String s = readAll(c);
                c.disconnect();
                final JSONObject j = new JSONObject(s);
                ui.post(() -> {
                    JSONObject last = j.optJSONObject("last");
                    JSONObject tot = j.optJSONObject("total");
                    StringBuilder sb = new StringBuilder();
                    if (last != null) {
                        sb.append("这一轮：").append(last.optInt("total", 0)).append(" token\n");
                        sb.append("  提问 ").append(last.optInt("prompt", 0))
                          .append(" · 回答 ").append(last.optInt("completion", 0)).append("\n\n");
                    }
                    if (tot != null) {
                        sb.append("累计：").append(tot.optInt("total", 0)).append(" token\n");
                    }
                    sb.append("轮数：").append(j.optInt("rounds", 0)).append("\n\n");
                    sb.append("上下文：").append(j.optString("contextHint", ""));
                    MDialog.card(MainActivity.this, "Token 统计",
                            sb.toString(), "好", null, null, null).show();
                });
            } catch (Exception e) {
                ui.post(() -> toast("拉不到统计"));
            }
        }).start();
    }

    // ---------- 定时消息 ----------
    private void showScheduleDialog() {
        final String[] opts = {"5 分钟后", "15 分钟后", "30 分钟后", "1 小时后", "2 小时后"};
        final int[] mins = {5, 15, 30, 60, 120};
        MDialog.sheet(this, "让她过一会找你", opts, i -> {
            apiPost("/app/schedule", "{\"minutes\":" + mins[i] + "}", r -> {
                if (r.contains("\"ok\":true")) {
                    toast("好，" + opts[i] + "她来找你");
                } else {
                    toast("排不上：" + r);
                }
            });
        }).show();
    }

    // ---------- 换头像 ----------
    /** 选封面（聊天背景图） */
    private void pickCover() {
        Intent i = new Intent(Intent.ACTION_GET_CONTENT);
        i.setType("image/*");
        i.addCategory(Intent.CATEGORY_OPENABLE);
        try {
            startActivityForResult(Intent.createChooser(i, "选一张当封面"), 2003);
        } catch (Exception e) {
            toast("打不开相册：" + e.getMessage());
        }
    }

    private void pickAvatar() {
        Intent i = new Intent(Intent.ACTION_GET_CONTENT);
        i.setType("image/*");
        i.addCategory(Intent.CATEGORY_OPENABLE);
        try {
            startActivityForResult(Intent.createChooser(i, "选个头像"), 2002);
        } catch (Exception e) {
            toast("打不开相册：" + e.getMessage());
        }
    }


    // ---------- 钥匙管理 ----------
    private void showKeysDialog() {
        new Thread(() -> {
            try {
                URL u = new URL("http://" + host + ":" + port + "/app/keys?token=" + token);
                HttpURLConnection c = (HttpURLConnection) u.openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(12000);
                final String s = readAll(c);
                c.disconnect();
                final JSONObject j = new JSONObject(s);
                ui.post(() -> {
                    JSONArray arr = j.optJSONArray("keys");
                    StringBuilder sb = new StringBuilder();
                    if (arr == null || arr.length() == 0) {
                        sb.append("还没发过钥匙。\n\n别人家的机器人要接进来，得给他一把。");
                    } else {
                        sb.append("已发出去 ").append(arr.length()).append(" 把：\n\n");
                        for (int i = 0; i < arr.length(); i++) {
                            JSONObject k = arr.optJSONObject(i);
                            if (k == null) continue;
                            sb.append("· ").append(k.optString("name"))
                              .append(" （").append(k.optString("scope")).append("）\n");
                            sb.append("  ").append(k.optString("token")).append("\n\n");
                        }
                    }
                    MDialog.sheet(MainActivity.this, sb.toString(),
                            new String[]{"发一把 chat 钥匙", "发一把 read 钥匙", "关"},
                            i -> {
                                if (i == 0) issueKey("chat");
                                else if (i == 1) issueKey("read");
                            }).show();
                });
            } catch (Exception e) {
                ui.post(() -> toast("拉不到钥匙列表"));
            }
        }).start();
    }

    private void issueKey(final String scope) {
        apiPost("/app/keys", "{\"name\":" + (scope.equals("chat") ? "\"聊天机器人\"" : "\"只读机器人\"") +
                ",\"scope\":\"" + scope + "\"}", r -> {
            try {
                JSONObject j = new JSONObject(r);
                if (!j.optBoolean("ok")) { toast("失败：" + j.optString("error")); return; }
                final String t = j.optString("token");
                MDialog.card(MainActivity.this, "新钥匙（只显示这一次）",
                        t + "\n\n把它给别人的机器人，权限：" + scope,
                        "复制", () -> {
                            android.content.ClipboardManager cm = (android.content.ClipboardManager)
                                    getSystemService(Context.CLIPBOARD_SERVICE);
                            cm.setPrimaryClip(android.content.ClipData.newPlainText("key", t));
                            toast("复制了");
                        }, "关", null).show();
            } catch (Exception e) {
                toast("解析失败");
            }
        });
    }

    // ---------- 长按菜单 ----------
    private void showMsgMenu(String text, View row, boolean mine, String msgId) {
        final String[] items = mine
                ? new String[]{"复制", "引用", "删除这条"}
                : new String[]{"复制", "引用", "重新生成", "删除这条"};

        MDialog.sheet(this, null, items, i -> {
                    String pick = items[i];
                    if (pick.equals("复制")) {
                        android.content.ClipboardManager cm = (android.content.ClipboardManager)
                                getSystemService(Context.CLIPBOARD_SERVICE);
                        cm.setPrimaryClip(android.content.ClipData.newPlainText("xiaojing", text));
                        toast("复制了");
                    } else if (pick.equals("引用")) {
                        input.setText("「" + (text.length() > 20 ? text.substring(0, 20) + "…" : text) + "」");
                        input.setSelection(input.getText().length());
                        input.requestFocus();
                    } else if (pick.equals("重新生成")) {
                        apiPost("/app/regen", "{\"id\":\"" + msgId + "\"}", r -> {
                            messages.removeAllViews();
                            drawnIds.clear();
                            lastDividerAt = 0;
                            loadAllHistory();
                            toast("重新生成了");
                        });
                    } else if (pick.equals("删除这条")) {
                        apiPost("/app/delete", "{\"id\":\"" + msgId + "\"}", r -> {
                            messages.removeView(row);
                            toast("删了");
                        });
                    }
        }).show();
    }

    private void drawText(String text, boolean mine) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(mine ? Gravity.END : Gravity.START);
        row.setPadding(0, dp(4), 0, dp(4));

        // 她的头像（左边）
        if (!mine) {
            row.addView(makeAvatar(dp(Theme.AVATAR), dp(9)));
        }

        TextView b = new TextView(this);
        b.setText(text);
        b.setTextSize(15);
        b.setTextColor(mine ? Theme.mineText() : Theme.text());
        b.setPadding(dp(14), dp(10), dp(14), dp(10));
        b.setMaxWidth((int) (getResources().getDisplayMetrics().widthPixels * 0.76));
        b.setLineSpacing(dp(2), 1f);
        b.setBackground(mine ? Theme.bubbleMine() : Theme.bubbleTheirs());
        if (Build.VERSION.SDK_INT >= 21) {
            b.setElevation(dp(1));
        }

        row.addView(b);
        messages.addView(row);

        final String msgId = currentMsgId;
        b.setOnLongClickListener(v -> {
            showMsgMenu(text, row, mine, msgId == null ? "" : msgId);
            return true;
        });
    }

    private void drawImage(String url, boolean mine) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(mine ? Gravity.END : Gravity.START);
        row.setPadding(0, dp(4), 0, dp(4));

        if (!mine) {
            row.addView(makeAvatar(dp(Theme.AVATAR), dp(9)));
        }

        final ImageView iv = new ImageView(this);
        int side = dp(150);
        iv.setLayoutParams(new LinearLayout.LayoutParams(side, side));
        iv.setScaleType(ImageView.ScaleType.CENTER_CROP);
        iv.setBackground(Theme.roundRect(Theme.chipBg(), 0, 14));
        if (Build.VERSION.SDK_INT >= 21) {
            iv.setClipToOutline(true);
            iv.setOutlineProvider(new android.view.ViewOutlineProvider() {
                @Override public void getOutline(View v, android.graphics.Outline o) {
                    o.setRoundRect(0, 0, v.getWidth(), v.getHeight(), dp(14));
                }
            });
            iv.setElevation(dp(1));
        }
        row.addView(iv);
        messages.addView(row);

        new Thread(() -> {
            try {
                final android.graphics.Bitmap bmp =
                        android.graphics.BitmapFactory.decodeStream(new URL(url).openStream());
                if (bmp != null) ui.post(() -> {
                    iv.setImageBitmap(bmp);
                    scrollDown();
                });
            } catch (Exception e) {
                ui.post(() -> {
                    TextView tv = new TextView(this);
                    tv.setText("[图片加载失败]");
                    tv.setTextSize(12);
                    tv.setTextColor(Color.GRAY);
                    row.removeAllViews();
                    row.addView(tv);
                });
            }
        }).start();
    }

    /** 画她的头像：有自定义图就显示图，没有就用鲸鱼 */
    private View makeAvatar(int size, int rightMargin) {
        LinearLayout.LayoutParams alp = new LinearLayout.LayoutParams(size, size);
        alp.rightMargin = rightMargin;

        if (avatarPath != null && !avatarPath.isEmpty()) {
            java.io.File f = new java.io.File(avatarPath);
            if (f.exists()) {
                ImageView iv = new ImageView(this);
                iv.setLayoutParams(alp);
                iv.setScaleType(ImageView.ScaleType.CENTER_CROP);
                try {
                    android.graphics.Bitmap bmp =
                            android.graphics.BitmapFactory.decodeFile(avatarPath);
                    if (bmp != null) iv.setImageBitmap(bmp);
                } catch (Exception ignored) {}
                if (Build.VERSION.SDK_INT >= 21) {
                    iv.setClipToOutline(true);
                    iv.setOutlineProvider(new android.view.ViewOutlineProvider() {
                        @Override public void getOutline(View v, android.graphics.Outline o) {
                            o.setOval(0, 0, v.getWidth(), v.getHeight());
                        }
                    });
                }
                return iv;
            }
        }

        // 兜底：用内置的默认头像图
        ImageView def = new ImageView(this);
        def.setLayoutParams(alp);
        def.setScaleType(ImageView.ScaleType.CENTER_CROP);
        try {
            def.setImageResource(R.drawable.default_avatar);
        } catch (Exception e) {
            // 图没了就退回鲸鱼
            TextView av = new TextView(this);
            av.setText("🐋");
            av.setTextSize(15);
            av.setGravity(Gravity.CENTER);
            av.setBackground(Theme.circle(0xFF8FD7F0, 0xFF4F9BD8));
            av.setLayoutParams(alp);
            return av;
        }
        if (Build.VERSION.SDK_INT >= 21) {
            def.setClipToOutline(true);
            def.setOutlineProvider(new android.view.ViewOutlineProvider() {
                @Override public void getOutline(View v, android.graphics.Outline o) {
                    o.setOval(0, 0, v.getWidth(), v.getHeight());
                }
            });
        }
        return def;
    }

    private int keyboardHeight = 0;      // 当前键盘高度（px）
    private int lastKeyboardHeight = 0;  // 记住上次的高度，表情面板用同一块

    /** 监听软键盘高度：键盘弹起记下高度，收起归零 */
    private void installKeyboardWatcher() {
        if (rootFrame == null) return;
        rootFrame.getViewTreeObserver().addOnGlobalLayoutListener(new android.view.ViewTreeObserver.OnGlobalLayoutListener() {
            @Override public void onGlobalLayout() {
                android.graphics.Rect r = new android.graphics.Rect();
                rootFrame.getWindowVisibleDisplayFrame(r);
                int screenH = rootFrame.getRootView().getHeight();
                int visibleH = r.bottom - r.top;
                int kb = screenH - visibleH - getStatusBarHeight();
                if (kb < dp(100)) kb = 0;

                if (kb != keyboardHeight) {
                    android.util.Log.i("XJKB", "键盘高度变了: " + keyboardHeight + " -> " + kb
                            + " 表情开着=" + (stickerPanel != null && stickerPanel.isShowing()));
                    keyboardHeight = kb;
                    if (kb > dp(100) && stickerPanel != null && stickerPanel.isShowing()) {
                        // 键盘真弹出来了 → 收掉表情（不管高度算得准不准）
                        stickerPanel.hide();
                        scrollDown();
                    }
                    if (kb > 0) lastKeyboardHeight = kb;
                    scrollDown();
                    if (kb > 0) MainActivity.this.scrollDown();
                }
            }
        });
    }

    /** 收起键盘 + 收起表情面板（点空白处用） */
    private void dismissInputPanel() {
        hideKeyboard();
        if (stickerPanel != null && stickerPanel.isShowing()) {
            stickerPanel.hide();
        }
        if (input != null) input.clearFocus();
        scrollDown();
    }

    /** 主动把键盘叫起来 */
    private void showKeyboard() {
        if (input == null) return;
        input.requestFocus();
        input.postDelayed(() -> {
            try {
                android.view.inputmethod.InputMethodManager im =
                        (android.view.inputmethod.InputMethodManager)
                                getSystemService(Context.INPUT_METHOD_SERVICE);
                if (im != null) im.showSoftInput(input, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);
            } catch (Exception ignored) {}
        }, 60);

        // ★ 立刻滚一次（不等键盘动画），再补一次兜底
        scrollDown();
        input.postDelayed(this::scrollDown, 260);
    }

    private void hideKeyboard() {
        try {
            android.view.inputmethod.InputMethodManager im =
                    (android.view.inputmethod.InputMethodManager)
                            getSystemService(Context.INPUT_METHOD_SERVICE);
            if (im != null && input != null) {
                im.hideSoftInputFromWindow(input.getWindowToken(), 0);
            }
        } catch (Exception ignored) {}
    }

    private int getStatusBarHeight() {
        int id = getResources().getIdentifier("status_bar_height", "dimen", "android");
        return id > 0 ? getResources().getDimensionPixelSize(id) : 0;
    }

    private void scrollDown() {
        scroll.post(() -> scroll.fullScroll(View.FOCUS_DOWN));
    }

    // ---------- 撤回 ----------
    private void doRecall(String text, View row) {
        new Thread(() -> {
            try {
                URL u = new URL("http://" + host + ":" + port + "/app/recall");
                HttpURLConnection c = (HttpURLConnection) u.openConnection();
                c.setRequestMethod("POST");
                c.setRequestProperty("authorization", "Bearer " + token);
                c.setRequestProperty("content-type", "application/json");
                c.setDoOutput(true);
                c.setConnectTimeout(8000);
                c.setReadTimeout(15000);
                JSONObject body = new JSONObject().put("text", text).put("at", System.currentTimeMillis());
                OutputStream os = c.getOutputStream();
                os.write(body.toString().getBytes("UTF-8"));
                os.close();
                int rc = c.getResponseCode();
                c.disconnect();
                ui.post(() -> {
                    if (rc == 200) {
                        messages.removeView(row);
                        toast("已撤回");
                    } else {
                        toast("撤回失败（" + rc + "）");
                    }
                });
            } catch (Exception e) {
                final String msg = e.getMessage();
                ui.post(() -> toast("撤回失败：" + msg));
            }
        }).start();
    }

    // ---------- 在线状态 ----------
    private void checkOnline() {
        // 顺手把状态字段设置和状态胶囊都刷一遍
        loadStatusFields(() -> { if (statusOpen) fetchStatus(); });
        new Thread(() -> {
            try {
                URL u = new URL("http://" + host + ":" + port + "/app/me");
                HttpURLConnection c = (HttpURLConnection) u.openConnection();
                c.setRequestProperty("authorization", "Bearer " + token);
                c.setConnectTimeout(5000);
                c.setReadTimeout(8000);
                int code = c.getResponseCode();
                c.disconnect();
                ui.post(() -> {
                    boolean on = code == 200;
                    statusBar.setText(on ? "在线" : "口令不对（" + code + "）");
                    statusBar.setTextColor(Theme.muted());
                    if (dotView != null) {
                        dotView.setTextColor(on ? Theme.ONLINE : Theme.OFFLINE);
                    }
                });
            } catch (Exception e) {
                ui.post(() -> {
                    statusBar.setText("连不上电脑");
                    statusBar.setTextColor(Theme.muted());
                    if (dotView != null) dotView.setTextColor(Theme.OFFLINE);
                });
            }
        }).start();
    }

    // ---------- 后台服务推来的新消息 ----------
    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            // 有推送就立刻拉一次（去重还是靠 drawIfNew）
            pollNew();
        }
    };

    /** 返回键：先关抽屉，再退出（不直接退 App） */
    @Override
    public void onBackPressed() {
        if (drawer != null && drawer.isShown()) {
            if (!drawer.popPage()) drawer.hide();   // 二级页先回一层，主页才关
            return;
        }
        if (stickerPanel != null && stickerPanel.isShowing()) {
            stickerPanel.hide();
            return;
        }
        super.onBackPressed();
    }

    // ---------- 小工具 ----------
    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density);
    }

    private void toast(String s) {
        Toast.makeText(this, s, Toast.LENGTH_SHORT).show();
    }

    private static String brief(String s) {
        if (s == null) return "null";
        String one = s.replace("\n", "/");
        return one.length() > 40 ? one.substring(0, 40) : one;
    }

    private static class Log {
        static void i(String s) { android.util.Log.i(TAG, s); }
        static void w(String s) { android.util.Log.w(TAG, s); }
    }

    /** 服务器的一条消息 */
    private static class Msg {
        String id, text;
        boolean mine;
        long at;

        static Msg from(JSONObject o) {
            Msg m = new Msg();
            m.id = o.optString("id");
            if (m.id == null || m.id.isEmpty()) m.id = "at" + o.optLong("at", 0);
            m.text = o.optString("content", "");
            m.mine = "user".equals(o.optString("role"));
            m.at = o.optLong("at", 0);
            return m;
        }
    }
}
