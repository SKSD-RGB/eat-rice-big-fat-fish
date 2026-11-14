package com.xiaoman.app;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/**
 * 设置抽屉（2026-11-13 晚加）
 * 从右侧滑出，装的是：她是谁、气泡、背景、连接、聊天、Token。
 */
public class SettingsDrawer {

    public interface Host {
        String getHost();
        String getPort();
        String getToken();
        String getHerName();
        void setHerName(String n);
        int getSkin();
        void setSkin(int idx);
        void onChangeAvatar();
        void onCover();
        void onClearChat();
        void onExportChat();
        void onTokenStats();
        void onSchedule();
        void onPersona();
        void onKeys();
        void onAiConfig();
        void onTheme();
        void onStatusToggle();
        void onStatusFields();
        void onMemories();
        void onAnalyze();
        void onChatBg();
        boolean isStatusOn();
        void onClose();
    }

    private final Activity act;
    private final Host host;
    private final LinearLayout root;
    private final LinearLayout body;
    private TextView titleView;              // 标题，二级页要改它
    private Runnable onBackOverride;          // 二级页的返回动作
    private boolean atSubPage = false;

    public SettingsDrawer(Activity a, Host h) {
        this.act = a;
        this.host = h;
        Theme.init(a);

        // 遮罩 + 抽屉，一起塞进一个 FrameLayout 由调用方 addView
        root = new LinearLayout(a);
        root.setOrientation(LinearLayout.VERTICAL);
        // 半透明玻璃底，让背景透出来一点
        GradientDrawable shellBg = new GradientDrawable();
        // 液态玻璃底
        GradientDrawable gBody = new GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                Theme.dark ? new int[]{0xFF2A2F37, 0xFF1E2229}
                           : new int[]{0xFFFFFFFF, 0xFFF2F5F9});
        // 左边留圆角，右侧贴边
        gBody.setCornerRadius(dp(0));   // 整页式，不留圆角
        gBody.setStroke(dp(1), Theme.dark ? 0x33FFFFFF : 0xAAFFFFFF);

        GradientDrawable gSheen = new GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{Theme.dark ? 0x22FFFFFF : 0x55FFFFFF, 0x00FFFFFF});
        gSheen.setCornerRadius(dp(0));

        // 背景图 + 一层薄雾（暗色模式雾更重），这样玻璃卡片才透得出来
        android.graphics.drawable.Drawable bgImg;
        try {
            bgImg = act.getResources().getDrawable(R.drawable.bg_mist);
        } catch (Exception e) {
            bgImg = gBody;
        }

        GradientDrawable veil = new GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                Theme.dark ? new int[]{0xB3101520, 0xCC0A0F18}
                           : new int[]{0x66FFFFFF, 0x99FFFFFF});

        root.setBackground(new android.graphics.drawable.LayerDrawable(
                new android.graphics.drawable.Drawable[]{bgImg, veil}));
        if (android.os.Build.VERSION.SDK_INT >= 21) root.setElevation(dp(20));
        root.setVisibility(View.GONE);
        root.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // 标题栏
        LinearLayout head = new LinearLayout(a);
        head.setOrientation(LinearLayout.HORIZONTAL);
        head.setGravity(Gravity.CENTER_VERTICAL);
        head.setPadding(dp(18), dp(16), dp(12), dp(12));
        GradientDrawable headBg = new GradientDrawable();
        headBg.setColor(Theme.dark ? 0x661A1F25 : 0x66FFFFFF);
        head.setBackground(headBg);

        // 返回按钮：圆形浅底 + <
        TextView back = new TextView(a);
        back.setText("‹");
        back.setTextSize(24);
        back.setGravity(Gravity.CENTER);
        back.setTextColor(Theme.text());
        GradientDrawable backBg = new GradientDrawable();
        backBg.setShape(GradientDrawable.OVAL);
        backBg.setColor(Theme.dark ? 0x22FFFFFF : 0xFFEDF1F6);
        back.setBackground(backBg);
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(dp(36), dp(36));
        blp.rightMargin = dp(12);
        head.addView(back, blp);
        back.setOnClickListener(v -> {
            if (!popPage()) hide();      // 有上一级就回，没有才关
        });

        TextView title = new TextView(a);
        titleView = title;
        title.setText("更多");
        title.setTextSize(17);
        title.setTextColor(Theme.text());
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        head.addView(title, tp);

        // 右边留个等宽的占位，标题才真居中
        android.view.View spacer = new android.view.View(a);
        head.addView(spacer, new LinearLayout.LayoutParams(dp(36), dp(36)));

        root.addView(head);

        // 滚动体
        ScrollView sc = new ScrollView(a);
        body = new LinearLayout(a);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(10), dp(10), dp(10), dp(30));
        sc.addView(body);
        root.addView(sc, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
    }

    /** 现在是不是在二级页 */
    public boolean isAtSubPage() { return atSubPage; }

    /** 从二级页回主设置。返回 true = 确实回了一层 */
    public boolean popPage() {
        if (!atSubPage) return false;
        atSubPage = false;
        titleView.setText("更多");
        build();
        return true;
    }

    /** 进二级页：标题换成 title，内容由 builder 自己往 body 里塞 */
    public void pushPage(String title, Runnable builder) {
        atSubPage = true;
        titleView.setText(title);
        body.removeAllViews();
        builder.run();
        if (body.getChildCount() == 0) {
            // 什么都没加，给个占位
            TextView tv = new TextView(act);
            tv.setText("这个页面还在做");
            tv.setTextColor(Theme.muted());
            tv.setPadding(dp(14), dp(40), dp(14), dp(40));
            body.addView(tv);
        }
    }

    /** 供外部（MainActivity）往二级页里加东西用 */
    public LinearLayout pageBody() { return body; }
    public Activity activity() { return act; }
    public int dpv(int v) { return dp(v); }

    public View getView() { return root; }
    public boolean isShown() { return root.getVisibility() == View.VISIBLE; }

    public void show() {
        build();
        root.setVisibility(View.VISIBLE);
        root.setAlpha(0f);
        root.animate().alpha(1f).setDuration(180).start();
    }

    public void hide() {
        root.animate().alpha(0f).setDuration(150).withEndAction(() -> {
            root.setVisibility(View.GONE);
            if (host != null) host.onClose();
        }).start();
    }

    // ---------- 构建 ----------
    private void build() {
        body.removeAllViews();

        section("她是谁");
        itemCard("✏️", "改名字", "她现在叫 " + host.getHerName(), () -> {
            MDialog.input(act, "她叫什么？", "输入名字", host.getHerName(), s -> {
                if (s != null && !s.isEmpty()) { host.setHerName(s); build(); }
            }).show();
        });
        itemCard("🖼️", "换头像", "挑一张图当她的脸", () -> host.onChangeAvatar());
        itemCard("🌄", "换封面", "聊天背景图，也当 App 封面", () -> host.onCover());
        itemCard("🎭", "换人格", "人格是提示词模板", () -> host.onPersona());

        // 气泡配色（横向色块，保持原样）
        section("气泡皮肤");
        LinearLayout skins = new LinearLayout(act);
        skins.setOrientation(LinearLayout.HORIZONTAL);
        skins.setPadding(dp(6), 0, dp(6), dp(10));
        int cur = host.getSkin();
        for (int i = 0; i < Theme.SKIN_NAMES.length; i++) {
            final int idx = i;
            TextView tc = new TextView(act);
            tc.setText(Theme.SKIN_NAMES[i]);
            tc.setTextSize(12);
            tc.setGravity(Gravity.CENTER);
            tc.setPadding(0, dp(10), 0, dp(10));
            tc.setTextColor(idx == cur ? Color.WHITE : Theme.text());
            int[] c = Theme.SKIN_COLORS[i];
            GradientDrawable g = new GradientDrawable(
                    GradientDrawable.Orientation.TL_BR, new int[]{c[0], c[1]});
            g.setCornerRadius(dp(13));
            if (idx == cur) g.setStroke(dp(2), Theme.accent());
            tc.setBackground(g);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0,
                    ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            lp.rightMargin = dp(4);
            tc.setLayoutParams(lp);
            tc.setOnClickListener(v -> { host.setSkin(idx); build(); });
            skins.addView(tc);
        }
        body.addView(skins);

        section("主题与外观");
        itemCard("🎨", "主题切换", Theme.dark ? "当前：深色" : "当前：浅色", () -> host.onTheme());
        itemCard("🖼️", "此对话背景设置", "背景色 / 深浅", () -> host.onChatBg());

        // 状态栏开关
        itemSwitchCard("📈", "状态栏", "聊天顶上那一行显不显示",
                host.isStatusOn(), on -> host.onStatusToggle());

        section("AI 设置");
        itemCard("⚙️", "配置 AI 信息", "模型 / 接口 / 密钥", () -> host.onAiConfig());
        itemCard("📊", "AI 状态栏设置", "定义状态字段", () -> host.onStatusFields());

        section("记忆");
        itemCard("🧠", "共享记忆与偏好", "看看她记住了什么", () -> host.onMemories());
        itemCard("✨", "AI 分析并提取偏好", "手动触发，存到对话记忆", () -> host.onAnalyze());

        section("此对话设置");
        itemCard("📤", "导出聊天记录", "txt 文件，含时间和角色", () -> host.onExportChat());
        itemCard("⏰", "定时消息", "让角色过一会主动找你", () -> host.onSchedule());
        itemCard("🧹", "清空聊天记录", "删除本对话全部消息", () -> host.onClearChat());
        itemCard("📈", "Token 统计", "本轮 / 累计 / 上下文", () -> host.onTokenStats());

        section("连接");
        itemCard("🖥️", "电脑地址", host.getHost() + ":" + host.getPort(), () -> {
            act.startActivity(new android.content.Intent(act, SetupActivity.class));
            hide();
        });
        itemCard("🔑", "我的口令", mask(host.getToken()), () -> {});
        itemCard("🤝", "给别人用的钥匙", "开放接口", () -> host.onKeys());
    }

    private String mask(String t) {
        if (t == null || t.isEmpty()) return "没设";
        return t.substring(0, Math.min(6, t.length())) + "…";
    }

    private void section(String title) {
        TextView h = new TextView(act);
        h.setText(title);
        h.setTextSize(11);
        h.setTextColor(Theme.muted());
        h.setPadding(dp(12), dp(16), dp(12), dp(6));
        h.setLetterSpacing(0.06f);
        body.addView(h);
    }

    /** 带开关的那行：右边是绿/灰胶囊，点完当场翻 */
    private void itemSwitch(String ico, String label, boolean on, java.util.function.Consumer<Boolean> onToggle) {
        LinearLayout row = new LinearLayout(act);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(12), dp(13), dp(14), dp(13));
        LiquidGlass.glassPanel(row, 20, Theme.dark, false);

        TextView i = new TextView(act);
        i.setText(ico);
        i.setTextSize(16);
        i.setGravity(Gravity.CENTER);
        GradientDrawable ig = new GradientDrawable();
        ig.setCornerRadius(dp(11));
        ig.setColor(Theme.dark ? 0x3347A8FF : 0x1A4A9EFF);
        i.setBackground(ig);
        i.setTextColor(Theme.dark ? 0xFF6FB6FF : 0xFF2E7BEA);
        LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(dp(36), dp(36));
        ip.rightMargin = dp(12);
        row.addView(i, ip);

        TextView l = new TextView(act);
        l.setText(label);
        l.setTextSize(14.5f);
        l.setTextColor(Theme.text());
        row.addView(l, new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        // 右边的开关（画成胶囊）
        final TextView sw = new TextView(act);
        final boolean[] state = {on};
        paintSwitch(sw, state[0]);
        row.addView(sw);

        row.setOnClickListener(v -> {
            state[0] = !state[0];
            paintSwitch(sw, state[0]);          // ① 当场翻
            if (onToggle != null) onToggle.accept(state[0]);   // ② 通知外面
        });

        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(8);
        body.addView(row, lp);
    }

    /** 画一个开关：开=绿，关=灰 */
    private void paintSwitch(TextView sw, boolean on) {
        GradientDrawable g = new GradientDrawable();
        g.setCornerRadius(dp(11));
        g.setColor(on ? 0xFF4CD07A : (Theme.dark ? 0x33FFFFFF : 0xFFD5DAE0));
        sw.setBackground(g);
        sw.setText(on ? "  开  " : "  关  ");
        sw.setTextSize(11.5f);
        sw.setTextColor(on ? 0xFFFFFFFF : Theme.muted());
        sw.setGravity(Gravity.CENTER);
        sw.setPadding(dp(6), dp(4), dp(6), dp(4));
        sw.setMinWidth(dp(52));
    }

    /** 截图那种卡片：左边图标、中间主标题+副标题、右边 > */
    /** 带副标题的开关卡片 */
    private void itemSwitchCard(String ico, String title, String sub,
                                boolean on, java.util.function.Consumer<Boolean> onToggle) {
        LinearLayout row = new LinearLayout(act);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(16), dp(15), dp(16), dp(15));

        GradientDrawable gBody = new GradientDrawable();
        gBody.setCornerRadius(dp(20));
        gBody.setColor(Theme.dark ? 0x33FFFFFF : 0xB8FFFFFF);
        gBody.setStroke(dp(1), Theme.dark ? 0x33FFFFFF : 0x66FFFFFF);
        row.setBackground(gBody);
        if (android.os.Build.VERSION.SDK_INT >= 21) row.setElevation(dp(2));

        TextView i = new TextView(act);
        i.setText(ico);
        i.setTextSize(17);
        i.setGravity(Gravity.CENTER);
        i.setTextColor(0xFF2E7BEA);
        LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(dp(40), dp(40));
        ip.rightMargin = dp(14);
        row.addView(i, ip);

        LinearLayout mid = new LinearLayout(act);
        mid.setOrientation(LinearLayout.VERTICAL);
        TextView tt = new TextView(act);
        tt.setText(title);
        tt.setTextSize(15.5f);
        tt.setTextColor(Theme.text());
        tt.setTypeface(null, android.graphics.Typeface.BOLD);
        mid.addView(tt);
        if (sub != null && !sub.isEmpty()) {
            TextView st = new TextView(act);
            st.setText(sub);
            st.setTextSize(12);
            st.setTextColor(Theme.muted());
            st.setPadding(0, dp(3), 0, 0);
            mid.addView(st);
        }
        row.addView(mid, new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        final TextView sw = new TextView(act);
        final boolean[] state = {on};
        paintSwitch(sw, state[0]);
        LinearLayout.LayoutParams sp2 = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        sp2.leftMargin = dp(8);
        row.addView(sw, sp2);

        row.setOnClickListener(v -> {
            state[0] = !state[0];
            paintSwitch(sw, state[0]);
            if (onToggle != null) onToggle.accept(state[0]);
        });

        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(10);
        body.addView(row, lp);
    }

    private void itemCard(String ico, String title, String sub, Runnable onClick) {
        LinearLayout row = new LinearLayout(act);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(16), dp(15), dp(16), dp(15));

        // 半透明玻璃卡片（照着截图那种）
        GradientDrawable gBody = new GradientDrawable();
        gBody.setCornerRadius(dp(20));
        gBody.setColor(Theme.dark ? 0x33FFFFFF : 0xB8FFFFFF);
        gBody.setStroke(dp(1), Theme.dark ? 0x33FFFFFF : 0x66FFFFFF);
        row.setBackground(gBody);
        if (android.os.Build.VERSION.SDK_INT >= 21) row.setElevation(dp(2));

        // 图标
        TextView i = new TextView(act);
        i.setText(ico);
        i.setTextSize(17);
        i.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(dp(40), dp(40));
        ip.rightMargin = dp(14);
        i.setTextColor(0xFF2E7BEA);
        row.addView(i, ip);

        // 中间：主标题 + 副标题
        LinearLayout mid = new LinearLayout(act);
        mid.setOrientation(LinearLayout.VERTICAL);
        TextView tt = new TextView(act);
        tt.setText(title);
        tt.setTextSize(15.5f);
        tt.setTextColor(Theme.text());
        tt.setTypeface(null, android.graphics.Typeface.BOLD);
        mid.addView(tt);
        if (sub != null && !sub.isEmpty()) {
            TextView st = new TextView(act);
            st.setText(sub);
            st.setTextSize(12);
            st.setTextColor(Theme.muted());
            st.setPadding(0, dp(3), 0, 0);
            mid.addView(st);
        }
        row.addView(mid, new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        // 右边 >
        TextView ar = new TextView(act);
        ar.setText("›");
        ar.setTextSize(20);
        ar.setTextColor(Theme.dark ? 0x66FFFFFF : 0x40607080);
        row.addView(ar);

        row.setOnClickListener(v -> onClick.run());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(10);
        body.addView(row, lp);
    }

    private void item(String ico, String label, String val, Runnable onClick) {
        LinearLayout row = new LinearLayout(act);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(12), dp(13), dp(14), dp(13));

        // 液态玻璃卡片
        LiquidGlass.glassPanel(row, 20, Theme.dark, false);

        // 左侧蓝色圆角图标块
        TextView i = new TextView(act);
        i.setText(ico);
        i.setTextSize(16);
        i.setGravity(Gravity.CENTER);
        GradientDrawable ig = new GradientDrawable();
        ig.setCornerRadius(dp(11));
        ig.setColor(Theme.dark ? 0x3347A8FF : 0x1A4A9EFF);
        i.setBackground(ig);
        i.setTextColor(Theme.dark ? 0xFF6FB6FF : 0xFF2E7BEA);
        LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(dp(36), dp(36));
        ip.rightMargin = dp(12);
        row.addView(i, ip);

        TextView l = new TextView(act);
        l.setText(label);
        l.setTextSize(14.5f);
        l.setTextColor(Theme.text());
        row.addView(l, new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        if (val != null && !val.isEmpty()) {
            TextView v = new TextView(act);
            v.setText(val);
            v.setTextSize(12);
            v.setTextColor(Theme.muted());
            v.setMaxWidth(dp(140));
            v.setSingleLine(true);
            v.setEllipsize(android.text.TextUtils.TruncateAt.END);
            row.addView(v);
        }

        row.setOnClickListener(v -> onClick.run());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(8);
        body.addView(row, lp);
    }

    private int dp(int v) {
        return (int) (v * act.getResources().getDisplayMetrics().density);
    }
}
