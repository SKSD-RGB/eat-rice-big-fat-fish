package com.xiaoman.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

// 前台常驻服务：挂着 SSE 长连接，她一说话就发通知
public class BridgeService extends Service {

    private static final String TAG = "XiaoManBridge";
    private static final String CH_KEEP = "keep";
    private static final String CH_MSG = "msg";
    private static final int ID_KEEP = 1;
    private static final int ID_MSG = 100;
    public static final String ACTION_STATUS = "com.xiaoman.app.STATUS";

    private volatile boolean running = false;
    private Thread thread;
    private int msgSeq = ID_MSG;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels();
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);

            NotificationChannel keep = new NotificationChannel(
                    CH_KEEP, "保持连接", NotificationManager.IMPORTANCE_MIN);
            keep.setShowBadge(false);
            nm.createNotificationChannel(keep);

            NotificationChannel msg = new NotificationChannel(
                    CH_MSG, "她发来的消息", NotificationManager.IMPORTANCE_HIGH);
            msg.enableVibration(true);
            msg.enableLights(true);
            msg.setLightColor(Color.parseColor("#07C160"));
            msg.setShowBadge(true);
            nm.createNotificationChannel(msg);
        }
    }

    private Notification keepNotification(String status) {
        Intent i = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 0, i,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                        ? PendingIntent.FLAG_IMMUTABLE : 0);

        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CH_KEEP)
                : new Notification.Builder(this);

        return b.setContentTitle("张小满")
                .setContentText("在线 · 守护中")
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentIntent(pi)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .build();
    }

    private void notifyMessage(String text) {
        Intent i = new Intent(this, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, msgSeq, i,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                        ? PendingIntent.FLAG_IMMUTABLE : 0);

        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CH_MSG)
                : new Notification.Builder(this);

        Notification n = b.setContentTitle("张小满")
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setWhen(System.currentTimeMillis())
                .build();

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        nm.notify(msgSeq++, n);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences sp = getSharedPreferences(SetupActivity.PREF, Context.MODE_PRIVATE);
        String host = sp.getString(SetupActivity.K_HOST, SetupActivity.DEF_HOST);
        String port = sp.getString(SetupActivity.K_PORT, SetupActivity.DEF_PORT);
        String token = sp.getString(SetupActivity.K_TOKEN, SetupActivity.DEF_TOKEN);

        // 先起前台（Android 要求 5 秒内必须）——先显示「正在连接」
        Notification.Builder b0 = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CH_KEEP) : new Notification.Builder(this);
        Intent i0 = new Intent(this, MainActivity.class);
        PendingIntent pi0 = PendingIntent.getActivity(this, 0, i0,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        startForeground(ID_KEEP, b0.setContentTitle("张小满")
                .setContentText("正在连接…")
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentIntent(pi0).setOngoing(true).setOnlyAlertOnce(true).build());

        if (host.isEmpty() || token.isEmpty()) {
            stopSelf();
            return START_NOT_STICKY;
        }

        if (running) return START_STICKY;
        running = true;

        final String url = "http://" + host + ":" + port + "/app/stream?token=" + token;

        thread = new Thread(() -> {
            int backoff = 2000;
            while (running) {
                HttpURLConnection c = null;
                BufferedReader r = null;
                try {
                    c = (HttpURLConnection) new URL(url).openConnection();
                    c.setRequestProperty("Accept", "text/event-stream");
                    c.setReadTimeout(0);
                    c.setConnectTimeout(10000);
                    int code = c.getResponseCode();
                    if (code != 200) throw new Exception("HTTP " + code);

                    updateKeep("在线");
                    Log.i(TAG, "SSE 已接通");
                    backoff = 2000;

                    r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"));
                    String line;
                    String event = null;
                    StringBuilder data = new StringBuilder();

                    while (running && (line = r.readLine()) != null) {
                        if (line.isEmpty()) {
                            if (event != null && data.length() > 0) {
                                handleEvent(event, data.toString());
                            }
                            event = null;
                            data.setLength(0);
                        } else if (line.startsWith("event:")) {
                            event = line.substring(6).trim();
                        } else if (line.startsWith("data:")) {
                            data.append(line.substring(5).trim());
                        }
                    }
                } catch (Exception e) {
                    Log.w(TAG, "连接断了: " + e.getMessage());
                    updateKeep("断开了，重连中…");
                } finally {
                    if (r != null) try { r.close(); } catch (Exception ignored) {}
                    if (c != null) c.disconnect();
                }

                if (!running) break;
                try { Thread.sleep(backoff); } catch (InterruptedException ignored) {}
                if (backoff < 30000) backoff *= 2;
            }
        }, "bridge-sse");
        thread.start();

        return START_STICKY;
    }

    private void handleEvent(String event, String data) {
        if (!"reply".equals(event)) return;
        String text = extractText(data);
        if (text == null || text.isEmpty()) return;
        Log.i(TAG, "收到推送: " + text);
        notifyMessage(text);
        // 通知 UI 刷新
        Intent i = new Intent(MainActivity.ACTION_NEW_MESSAGE);
        i.putExtra("text", text);
        sendBroadcast(i);
    }

    // 极简 JSON 提取 "text":"..."
    private String extractText(String json) {
        int k = json.indexOf("\"text\":\"");
        if (k < 0) return null;
        int start = k + 8;
        StringBuilder sb = new StringBuilder();
        for (int i = start; i < json.length(); i++) {
            char ch = json.charAt(i);
            if (ch == '\\') {
                i++;
                if (i < json.length()) {
                    char e = json.charAt(i);
                    if (e == 'n') sb.append('\n');
                    else if (e == 't') sb.append('\t');
                    else if (e == '"') sb.append('"');
                    else if (e == '\\') sb.append('\\');
                    else if (e == 'u' && i + 4 < json.length()) {
                        try {
                            sb.append((char) Integer.parseInt(json.substring(i + 1, i + 5), 16));
                            i += 4;
                        } catch (Exception ignored) {}
                    } else sb.append(e);
                }
            } else if (ch == '"') {
                break;
            } else {
                sb.append(ch);
            }
        }
        return sb.toString();
    }

    private String lastStatus = "";
    private void updateKeep(String status) {
        // 状态文字只广播给界面用；通知本身固定写「在线」
        if (status.equals(lastStatus)) return;
        lastStatus = status;
        Log.i(TAG, "状态变化: " + status);
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if ("在线".equals(status)) {
                nm.notify(ID_KEEP, keepNotification(status));
            } else if (status.startsWith("断开")) {
                // 断开了就别在通知栏装在线，改成提醒
                Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                        ? new Notification.Builder(this, CH_KEEP) : new Notification.Builder(this);
                Intent i = new Intent(this, MainActivity.class);
                PendingIntent pi = PendingIntent.getActivity(this, 0, i,
                        Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
                nm.notify(ID_KEEP, b.setContentTitle("张小满")
                        .setContentText("断开了，正在重连…")
                        .setSmallIcon(android.R.drawable.stat_sys_warning)
                        .setContentIntent(pi).setOngoing(true).setOnlyAlertOnce(true).build());
            }
        } catch (Exception e) {
            Log.w(TAG, "更新常驻通知失败: " + e.getMessage());
        }
        try {
            Intent i = new Intent(ACTION_STATUS);
            i.putExtra("status", status);
            sendBroadcast(i);
        } catch (Exception e) {
            Log.w(TAG, "广播状态失败: " + e.getMessage());
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (thread != null) thread.interrupt();
        super.onDestroy();
    }
}
