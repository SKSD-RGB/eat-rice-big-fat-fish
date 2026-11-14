package com.xiaoman.app;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 设置里那 7 样（2026-11-14 晚）
 *
 * ① 配置 AI 信息      ② 主题切换       ③ 状态栏开关
 * ④ AI 状态栏设置     ⑤ 共享记忆与偏好  ⑥ AI 分析并提取偏好
 * ⑦ 此对话背景
 *
 * 每个方法自己画界面、自己打接口，不依赖 MainActivity 的私有方法。
 */
public class SettingsFeatures {

    private final Activity act;
    private final String host, port, token;
    private final Runnable onNeedRebuild;   // 改完之后让主界面重画
    /** 状态栏某字段被点：(key, 现在开没开) */
    public interface OnFieldToggle { void onToggle(String key, boolean on); }

    private OnFieldToggle onStatusChanged;   // 状态栏字段变了，立刻重画
    private Runnable onThemeChanged;         // 主题/背景变了，立刻重画整个界面

    public void setOnStatusChanged(OnFieldToggle r) { this.onStatusChanged = r; }
    public void setOnThemeChanged(Runnable r) { this.onThemeChanged = r; }

    public SettingsFeatures(Activity a, String h, String p, String t, Runnable rebuild) {
        this.act = a;
        this.host = h;
        this.port = p;
        this.token = t;
        this.onNeedRebuild = rebuild;
        Theme.init(a);
    }

    // ==================== ① 配置 AI 信息 ====================

    public void showAiConfig() {
        new Thread(() -> {
            String s = get("/app/ai");
            act.runOnUiThread(() -> {
                String model = "", base = "", masked = "没设";
                boolean hasKey = false;
                try {
                    JSONObject j = new JSONObject(s);
                    model = j.optString("model", "");
                    base = j.optString("apiBase", "");
                    masked = j.optString("apiKeyMasked", "没设");
                    hasKey = j.optBoolean("hasKey", false);
                } catch (Exception ignored) {}

                final String fModel = model, fBase = base;
                LinearLayout box = column();
                box.addView(hint("当前：" + model + "\n接口：" + base + "\n密钥：" + masked));

                box.addView(row("模型", model, () ->
                        MDialog.input(act, "模型名", "比如 deepseek-chat", fModel, v -> {
                            if (v != null && !v.isEmpty()) {
                                post("/app/ai", "{\"model\":\"" + esc(v) + "\"}",
                                        r -> toast("模型换成 " + v));
                            }
                        }).show()));

                box.addView(row("接口地址", base, () ->
                        MDialog.input(act, "接口地址", "https://api.deepseek.com", fBase, v -> {
                            if (v != null && !v.isEmpty()) {
                                post("/app/ai", "{\"apiBase\":\"" + esc(v) + "\"}", r -> toast("地址改好了"));
                            }
                        }).show()));

                box.addView(row("密钥", hasKey ? "已设置" : "没设", () ->
                        MDialog.input(act, "新的 API 密钥", "sk-...", "", v -> {
                            if (v != null && !v.isEmpty()) {
                                post("/app/ai", "{\"apiKey\":\"" + esc(v) + "\"}", r -> toast("密钥换好了"));
                            }
                        }).show()));

                show("配置 AI 信息", box);
            });
        }).start();
    }

    // ==================== ② 主题切换 ====================

    public void showThemePicker() {
        SharedPreferences sp = act.getSharedPreferences("xiaoman", Activity.MODE_PRIVATE);
        int cur = sp.getInt("themeMode", 0);   // 0 浅色 1 深色 2 跟系统

        MDialog.sheet(act, "主题", new String[]{"浅色", "深色", "跟随系统"}, i -> {
            sp.edit().putInt("themeMode", i).apply();
            Theme.dark = (i == 1) || (i == 2 && isSystemDark());
            toast("换成" + new String[]{"浅色", "深色", "跟随系统"}[i]);
            // 立刻重画整个界面
            if (onThemeChanged != null) onThemeChanged.run();
        }).show();
    }

    private boolean isSystemDark() {
        int m = act.getResources().getConfiguration().uiMode
                & android.content.res.Configuration.UI_MODE_NIGHT_MASK;
        return m == android.content.res.Configuration.UI_MODE_NIGHT_YES;
    }

    // ==================== ④ AI 状态栏设置 ====================

    private SettingsDrawer pageHost;     // 有它就在设置页里开二级页，没有就弹窗

    public void setPageHost(SettingsDrawer d) { this.pageHost = d; }

    /** AI 状态栏设置：优先做成设置页里的二级页 */
    public void showStatusFieldsPage() {
        if (pageHost == null) { showStatusFields(); return; }

        new Thread(() -> {
            String s = get("/app/statusfields");
            act.runOnUiThread(() -> {
                String[] keys, labels;
                boolean[] on;
                try {
                    JSONArray arr = new JSONObject(s).optJSONArray("fields");
                    int n = arr == null ? 0 : arr.length();
                    keys = new String[n]; labels = new String[n]; on = new boolean[n];
                    for (int i = 0; i < n; i++) {
                        JSONObject f = arr.getJSONObject(i);
                        keys[i] = f.optString("key");
                        labels[i] = f.optString("label", keys[i]);
                        on[i] = f.optBoolean("on", true);
                    }
                } catch (Exception e) { toast("拿不到设置"); return; }

                try {
                    localFields = new JSONArray();
                    for (int i = 0; i < keys.length; i++) {
                        localFields.put(new JSONObject()
                                .put("key", keys[i]).put("label", labels[i]).put("on", on[i]));
                    }
                } catch (Exception ignored) {}

                final boolean[] state = on.clone();

                pageHost.pushPage("AI 状态栏设置", () -> {
                    LinearLayout body = pageHost.pageBody();
                    int d = pageHost.dpv(14);

                    TextView hint = new TextView(act);
                    hint.setText("聊天顶上那一行显示哪些。点一下切换，立刻生效。");
                    hint.setTextSize(12);
                    hint.setTextColor(Theme.muted());
                    hint.setPadding(d, d, d, d);
                    body.addView(hint);

                    for (int i = 0; i < keys.length; i++) {
                        final int idx = i;
                        final String key = keys[i];

                        LinearLayout r = new LinearLayout(act);
                        r.setOrientation(LinearLayout.HORIZONTAL);
                        r.setGravity(Gravity.CENTER_VERTICAL);
                        r.setPadding(d + 6, d + 4, d + 6, d + 4);
                        GradientDrawable g = new GradientDrawable();
                        g.setCornerRadius(pageHost.dpv(14));
                        g.setColor(Theme.dark ? 0x22FFFFFF : 0xFFF4F6F9);
                        r.setBackground(g);

                        TextView lt = new TextView(act);
                        lt.setText(labels[i]);
                        lt.setTextSize(15f);
                        lt.setTextColor(Theme.text());
                        r.addView(lt, new LinearLayout.LayoutParams(0,
                                ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

                        final TextView vv = new TextView(act);
                        vv.setText(state[i] ? "显示" : "隐藏");
                        vv.setTextSize(13f);
                        vv.setTextColor(state[i] ? Theme.accent() : Theme.muted());
                        r.addView(vv);

                        r.setOnClickListener(v -> {
                            state[idx] = !state[idx];
                            vv.setText(state[idx] ? "显示" : "隐藏");
                            vv.setTextColor(state[idx] ? Theme.accent() : Theme.muted());
                            if (onStatusChanged != null) onStatusChanged.onToggle(key, state[idx]);
                            saveStatusFields(key, labels[idx], state[idx]);
                        });

                        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                        lp.bottomMargin = pageHost.dpv(8);
                        r.setLayoutParams(lp);
                        body.addView(r);
                    }
                });
            });
        }).start();
    }

    public void showStatusFields() {
        new Thread(() -> {
            String s = get("/app/statusfields");
            act.runOnUiThread(() -> {
                String[] keys, labels;
                boolean[] on;
                try {
                    JSONArray arr = new JSONObject(s).optJSONArray("fields");
                    int n = arr == null ? 0 : arr.length();
                    keys = new String[n];
                    labels = new String[n];
                    on = new boolean[n];
                    for (int i = 0; i < n; i++) {
                        JSONObject f = arr.getJSONObject(i);
                        keys[i] = f.optString("key");
                        labels[i] = f.optString("label", keys[i]);
                        on[i] = f.optBoolean("on", true);
                    }
                } catch (Exception e) {
                    toast("拿不到设置");
                    return;
                }

                // 本地表以这次拉到的为准
                try {
                    localFields = new JSONArray();
                    for (int i = 0; i < keys.length; i++) {
                        localFields.put(new JSONObject()
                                .put("key", keys[i]).put("label", labels[i]).put("on", on[i]));
                    }
                } catch (Exception ignored) {}

                LinearLayout box = column();
                box.addView(hint("哪些要显示在聊天顶上那一行\n点一下切换显示/隐藏"));

                final boolean[] state = on.clone();
                for (int i = 0; i < keys.length; i++) {
                    final int idx = i;
                    final String key = keys[i];
                    final String label = labels[i];

                    // 自己搭一行：左边标签，右边开关文字
                    LinearLayout r = new LinearLayout(act);
                    r.setOrientation(LinearLayout.HORIZONTAL);
                    r.setGravity(Gravity.CENTER_VERTICAL);
                    r.setPadding(dp(14), dp(14), dp(14), dp(14));
                    GradientDrawable g = new GradientDrawable();
                    g.setCornerRadius(dp(14));
                    g.setColor(Theme.dark ? 0x22FFFFFF : 0xFFF4F6F9);
                    r.setBackground(g);

                    TextView lt = new TextView(act);
                    lt.setText(label);
                    lt.setTextSize(14.5f);
                    lt.setTextColor(Theme.text());
                    r.addView(lt, new LinearLayout.LayoutParams(0,
                            ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

                    final TextView valView = new TextView(act);
                    valView.setText(state[i] ? "显示" : "隐藏");
                    valView.setTextSize(12.5f);
                    valView.setTextColor(state[i] ? Theme.accent() : Theme.muted());
                    r.addView(valView);

                    r.setOnClickListener(v -> {
                        state[idx] = !state[idx];
                        // ① 界面文字立刻变
                        valView.setText(state[idx] ? "显示" : "隐藏");
                        valView.setTextColor(state[idx] ? Theme.accent() : Theme.muted());
                        // ② 聊天顶上那行立刻重画
                        if (onStatusChanged != null) onStatusChanged.onToggle(key, state[idx]);
                        // ③ 后台存
                        saveStatusFields(key, label, state[idx]);
                    });

                    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                    lp.bottomMargin = dp(8);
                    r.setLayoutParams(lp);
                    box.addView(r);
                }

                show("AI 状态栏设置", box);
            });
        }).start();
    }

    /** 当前这份字段表（本地维护，点一下就地改） */
    private JSONArray localFields;

    /** 点开关：只改本地 + 后台静默存，绝不回来覆盖界面 */
    private void saveStatusFields(String key, String label, boolean on) {
        try {
            if (localFields == null) localFields = new JSONArray();
            boolean found = false;
            for (int i = 0; i < localFields.length(); i++) {
                JSONObject f = localFields.optJSONObject(i);
                if (f != null && key.equals(f.optString("key"))) {
                    f.put("on", on);
                    found = true;
                    break;
                }
            }
            if (!found) {
                localFields.put(new JSONObject().put("key", key).put("label", label).put("on", on));
            }

            // 全量推给后端（后台，不等结果、不回调）
            final String body = "{\"fields\":" + localFields.toString() + "}";
            new Thread(() -> postSync("/app/statusfields", body)).start();
        } catch (Exception ignored) {}
    }

    // ==================== ⑤ 共享记忆与偏好 ====================

    public void showMemories() {
        new Thread(() -> {
            String s = get("/app/memories");
            act.runOnUiThread(() -> {
                StringBuilder sb = new StringBuilder();
                try {
                    JSONObject j = new JSONObject(s);
                    JSONObject c = j.optJSONObject("counts");
                    sb.append("记忆 ").append(c.optInt("memories", 0)).append(" 条")
                      .append(" · 偏好 ").append(c.optInt("insights", 0)).append(" 条\n");
                    sb.append("说话样本 ").append(c.optInt("styleSamples", 0)).append(" 条\n\n");

                    JSONArray prof = j.optJSONArray("profiles");
                    if (prof != null && prof.length() > 0) {
                        JSONObject p0 = prof.getJSONObject(0);
                        String pt = p0.optString("text", "");
                        if (!pt.isEmpty()) {
                            sb.append("【他这个人】\n").append(pt).append("\n\n");
                        }
                    }

                    JSONArray ins = j.optJSONArray("insights");
                    if (ins != null && ins.length() > 0) {
                        sb.append("【偏好】\n");
                        for (int i = 0; i < ins.length(); i++) {
                            sb.append("· ").append(ins.optString(i)).append("\n");
                        }
                    } else {
                        sb.append("还没有偏好记录。\n点「AI 分析并提取偏好」就有了。");
                    }
                } catch (Exception e) {
                    sb.append("读不出来：").append(e.getMessage());
                }
                MDialog.card(act, "共享记忆与偏好", sb.toString(), "关闭", null, null, null).show();
            });
        }).start();
    }

    // ==================== ⑥ AI 分析并提取偏好 ====================

    public void doAnalyze() {
        MDialog.card(act, "AI 分析并提取偏好",
                "会把她这阵子你说过的话交给她自己看一遍，\n提炼出「你是什么样的人」和「你喜欢怎么被对待」，\n然后存进记忆里。\n\n会花一点 token（大概几分钱）。",
                "开始分析", () -> {
                    toast("正在分析……大概十几秒");
                    new Thread(() -> {
                        String s = postSync("/app/analyze", "{}");
                        act.runOnUiThread(() -> {
                            try {
                                JSONObject j = new JSONObject(s);
                                if (j.optBoolean("ok")) {
                                    String p = j.optString("profile", "");
                                    JSONArray ins = j.optJSONArray("insights");
                                    StringBuilder sb = new StringBuilder();
                                    if (!p.isEmpty()) sb.append("【他这个人】\n").append(p).append("\n\n");
                                    if (ins != null && ins.length() > 0) {
                                        sb.append("【新提炼的偏好】\n");
                                        for (int i = 0; i < ins.length(); i++) {
                                            sb.append("· ").append(ins.optString(i)).append("\n");
                                        }
                                    }
                                    MDialog.card(act, "分析好了", sb.toString(), "知道了", null, null, null).show();
                                } else {
                                    toast("分析失败：" + j.optString("error", ""));
                                }
                            } catch (Exception e) {
                                toast("分析失败");
                            }
                        });
                    }).start();
                }, null, null).show();
    }

    // ==================== ⑦ 此对话背景 ====================

    public void showChatBg() {
        SharedPreferences sp = act.getSharedPreferences("xiaoman", Activity.MODE_PRIVATE);
        int cur = sp.getInt("chatBg", 0);

        MDialog.sheet(act, "此对话背景",
                new String[]{"默认（主题色）", "纯白", "深灰", "暖米"},
                i -> {
            sp.edit().putInt("chatBg", i).apply();
            toast("背景换好了");
            if (onThemeChanged != null) onThemeChanged.run();   // 立刻重画
        }).show();
    }

    // ==================== 通用零件 ====================

    private LinearLayout column() {
        LinearLayout box = new LinearLayout(act);
        box.setOrientation(LinearLayout.VERTICAL);
        return box;
    }

    private TextView hint(String s) {
        TextView t = new TextView(act);
        t.setText(s);
        t.setTextSize(12);
        t.setTextColor(Theme.muted());
        t.setPadding(dp(4), dp(4), dp(4), dp(10));
        t.setLineSpacing(0, 1.35f);
        return t;
    }

    private View row(String label, String val, Runnable click) {
        LinearLayout r = new LinearLayout(act);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        r.setPadding(dp(14), dp(14), dp(14), dp(14));
        GradientDrawable g = new GradientDrawable();
        g.setCornerRadius(dp(14));
        g.setColor(Theme.dark ? 0x22FFFFFF : 0xFFF4F6F9);
        r.setBackground(g);

        TextView l = new TextView(act);
        l.setText(label);
        l.setTextSize(14.5f);
        l.setTextColor(Theme.text());
        r.addView(l, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        TextView v = new TextView(act);
        v.setText(val);
        v.setTextSize(12.5f);
        v.setTextColor(Theme.muted());
        r.addView(v);

        r.setOnClickListener(x -> click.run());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(8);
        r.setLayoutParams(lp);
        return r;
    }

    private void show(String title, View content) {
        ScrollView sc = new ScrollView(act);
        sc.addView(content);
        MDialog.cardView(act, title, sc, "关闭").show();
    }

    private void toast(String s) {
        android.widget.Toast.makeText(act, s, android.widget.Toast.LENGTH_SHORT).show();
    }

    private String esc(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "");
    }

    private int dp(int v) {
        return (int) (v * act.getResources().getDisplayMetrics().density);
    }

    // ---------- 网络 ----------

    private String get(String path) {
        try {
            URL u = new URL("http://" + host + ":" + port + path);
            HttpURLConnection c = (HttpURLConnection) u.openConnection();
            c.setRequestProperty("authorization", "Bearer " + token);
            c.setConnectTimeout(8000);
            c.setReadTimeout(15000);
            String s = readAll(c);
            c.disconnect();
            return s;
        } catch (Exception e) {
            return "{\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    private String postSync(String path, String json) {
        try {
            URL u = new URL("http://" + host + ":" + port + path);
            HttpURLConnection c = (HttpURLConnection) u.openConnection();
            c.setRequestMethod("POST");
            c.setRequestProperty("authorization", "Bearer " + token);
            c.setRequestProperty("content-type", "application/json");
            c.setDoOutput(true);
            c.setConnectTimeout(10000);
            c.setReadTimeout(120000);
            c.getOutputStream().write(json.getBytes("UTF-8"));
            c.getOutputStream().close();
            String s = readAll(c);
            c.disconnect();
            return s;
        } catch (Exception e) {
            return "{\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    private void post(String path, String json, java.util.function.Consumer<String> cb) {
        new Thread(() -> {
            String s = postSync(path, json);
            act.runOnUiThread(() -> {
                if (cb != null) cb.accept(s);
                if (onNeedRebuild != null) onNeedRebuild.run();
            });
        }).start();
    }

    private String readAll(HttpURLConnection c) throws Exception {
        InputStream in = c.getInputStream();
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        in.close();
        return new String(bo.toByteArray(), "UTF-8");
    }
}
