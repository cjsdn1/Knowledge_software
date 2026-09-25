package cn.shizhi.study;

import android.webkit.JavascriptInterface;
import android.webkit.WebResourceResponse;
import android.util.Base64;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.*;

final class Bridge {
    final ExecutorService executor = Executors.newFixedThreadPool(3);
    private final MainActivity activity; private final Vault vault;
    Bridge(MainActivity activity) { this.activity = activity; vault = new Vault(activity); }
    private String address(String base) throws Exception {
        URI uri = new URI(base.trim());
        if (uri.getUserInfo() != null || uri.getHost() == null || uri.getQuery() != null || uri.getFragment() != null || !(uri.getPath().isEmpty() || uri.getPath().equals("/"))) throw new IOException("请输入不带路径、口令或参数的电脑地址");
        if (!"https".equals(uri.getScheme()) && !("http".equals(uri.getScheme()) && (InetAddress.getByName(uri.getHost()).isSiteLocalAddress() || InetAddress.getByName(uri.getHost()).isLoopbackAddress()))) throw new IOException("远程连接须使用 HTTPS；HTTP 仅允许局域网");
        return base.trim().replaceAll("/+$", "");
    }
    private HttpURLConnection connection(String base, String path, String method, String token) throws Exception {
        if (!path.startsWith("/api/") || path.contains("..") || path.contains("\\") || path.contains("#")) throw new IOException("接口路径无效");
        HttpURLConnection con = (HttpURLConnection) new URL(address(base) + path).openConnection();
        con.setInstanceFollowRedirects(false); con.setConnectTimeout(10000); con.setReadTimeout(30000);
        con.setRequestMethod("PATCH".equals(method) ? "POST" : method);
        if ("PATCH".equals(method)) con.setRequestProperty("X-Study-Method", "PATCH");
        if (!token.isEmpty()) con.setRequestProperty("Authorization", "Bearer " + token);
        return con;
    }
    private JSONObject http(String base, String path, String method, JSONObject body, String token) throws Exception {
        HttpURLConnection con = connection(base, path, method, token);
        try {
            if (body != null && !method.equals("GET")) { con.setDoOutput(true); con.setRequestProperty("Content-Type", "application/json"); try (OutputStream out = con.getOutputStream()) { out.write(body.toString().getBytes(StandardCharsets.UTF_8)); } }
            int status = con.getResponseCode(); InputStream raw = status >= 400 ? con.getErrorStream() : con.getInputStream();
            String result; try (InputStream in = raw) { result = in == null ? "{}" : new String(in.readAllBytes(), StandardCharsets.UTF_8); }
            return new JSONObject().put("status", status).put("body", new org.json.JSONTokener(result).nextValue());
        } finally { con.disconnect(); }
    }
    private void reply(String id, int status, Object value) {
        String json = value.toString(); activity.runOnUiThread(() -> { if (!activity.isDestroyed()) activity.web.evaluateJavascript("window.studyNativeResult(" + JSONObject.quote(id) + "," + status + "," + JSONObject.quote(json) + ")", null); });
    }
    @JavascriptInterface public void call(String id, String action, String encoded) {
        executor.execute(() -> {
            try {
                JSONObject p = new JSONObject(encoded), result = new JSONObject();
                switch (action) {
                    case "request": {
                        if (vault.base().isEmpty()) { reply(id, 401, new JSONObject().put("error", "请先配对电脑")); return; }
                        JSONObject response = http(vault.base(), p.getString("path"), p.optString("method", "GET"), p.optJSONObject("body"), vault.token());
                        reply(id, response.getInt("status"), response.get("body")); return;
                    }
                    case "connect": {
                        String base = address(p.getString("base")); JSONObject response = http(base, "/api/pairing/claim", "POST", new JSONObject().put("code", p.getString("code")).put("name", p.optString("name", "Android 手机")), "");
                        if (response.getInt("status") != 201) { reply(id, response.getInt("status"), response.get("body")); return; }
                        JSONObject body = response.getJSONObject("body"); vault.save(base, body.getString("serverId"), body.getString("token")); result.put("serverId", body.getString("serverId")); break;
                    }
                    case "toolPanel": {
                        boolean allowed = android.provider.Settings.canDrawOverlays(activity); result.put("opened", allowed);
                        if (allowed) activity.runOnUiThread(() -> activity.startForegroundService(new android.content.Intent(activity, OverlayService.class).setAction("show-panel").putExtra("tool", p.optString("tool", "explain"))));
                        break;
                    }
                    case "setContext": activity.getSharedPreferences("context", 0).edit().putString("mode", p.optString("mode", "study")).putString("courseId", p.optString("courseId")).apply(); break;
                    case "inbox": result.put("items", Inbox.list(activity)); break;
                    case "readInbox": {
                        File file = Inbox.file(activity, p.getString("id")); long offset = p.getLong("offset"); if (offset < 0 || offset >= file.length()) throw new IOException("附件偏移无效");
                        byte[] chunk = new byte[(int) Math.min(256 * 1024, file.length() - offset)]; try (RandomAccessFile in = new RandomAccessFile(file, "r")) { in.seek(offset); in.readFully(chunk); } result.put("data", Base64.encodeToString(chunk, Base64.NO_WRAP)); break;
                    }
                    case "ackInbox": Inbox.acknowledge(activity, p.getString("id")); break;
                    case "capture": activity.runOnUiThread(() -> activity.requestCapture(p.optString("tool", "explain"))); break;
                    case "overlay": activity.runOnUiThread(() -> activity.overlay(p.optBoolean("enabled"))); break;
                    case "startRecording": if (p.optString("sessionId").isEmpty()) throw new IOException("请先开始课堂"); activity.runOnUiThread(() -> activity.record(p)); break;
                    case "recordingStatus": result.put("recording", RecordService.active != null); break;
                    case "stopRecording": activity.runOnUiThread(() -> { if (RecordService.active != null) RecordService.active.finish(); reply(id, 200, new JSONObject()); }); return;
                    default: throw new IOException("不支持的原生操作");
                }
                reply(id, 200, result);
            } catch (Exception e) { try { reply(id, 503, new JSONObject().put("error", e.getMessage() == null ? "连接失败" : e.getMessage())); } catch (Exception ignored) {} }
        });
    }
    WebResourceResponse file(String path) {
        try {
            HttpURLConnection con = connection(vault.base(), path, "GET", vault.token());
            if (con.getResponseCode() != 200) { con.disconnect(); return new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream("文件不可用".getBytes(StandardCharsets.UTF_8))); }
            String mime = con.getContentType().split(";")[0];
            InputStream stream = new FilterInputStream(con.getInputStream()) { @Override public void close() throws IOException { super.close(); con.disconnect(); } };
            return new WebResourceResponse(mime, "utf-8", 200, "OK", Map.of("X-Content-Type-Options", "nosniff", "Cache-Control", "no-store"), stream);
        } catch (Exception e) { return new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0])); }
    }
}
