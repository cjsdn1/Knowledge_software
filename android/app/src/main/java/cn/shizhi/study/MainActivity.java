package cn.shizhi.study;

import android.Manifest;
import android.app.Activity;
import android.content.*;
import android.content.pm.PackageManager;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.webkit.*;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.*;
import java.util.ArrayList;

public class MainActivity extends Activity {
    static final String ORIGIN = "https://appassets.androidplatform.net";
    static volatile boolean foreground;
    WebView web; Bridge bridge; private ValueCallback<Uri[]> fileCallback; private Runnable microphoneGranted;
    private boolean webReady;
    private String pendingOverlayTool, pendingCaptureId, captureTool = "capture";
    @Override public void onCreate(Bundle bundle) {
        super.onCreate(bundle);
        web = new WebView(this); setContentView(web);
        // Keep content clear of status/navigation bars under Android 15 edge-to-edge enforcement.
        web.setOnApplyWindowInsetsListener((v, insets) -> { v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom()); return insets; });
        WebSettings settings = web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true); settings.setAllowFileAccess(false); settings.setAllowContentAccess(true); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW); settings.setMediaPlaybackRequiresUserGesture(true);
        bridge = new Bridge(this); web.addJavascriptInterface(bridge, "StudyNative");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return !request.getUrl().toString().startsWith(ORIGIN + "/"); }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!"appassets.androidplatform.net".equals(uri.getHost()) || !"https".equals(uri.getScheme())) return new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
                if (uri.getPath().startsWith("/api/files/")) return bridge.file(uri.getPath());
                String path = uri.getPath(); if (path == null || path.equals("/")) path = "/index.html";
                if (path.contains("..") || path.contains("\\") || path.contains("//")) return new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
                String name = path.substring(1), mime = name.endsWith(".html") ? "text/html" : name.endsWith(".js") || name.endsWith(".mjs") ? "text/javascript" : name.endsWith(".css") ? "text/css" : name.endsWith(".svg") ? "image/svg+xml" : name.endsWith(".webmanifest") ? "application/manifest+json" : "application/octet-stream";
                try { return new WebResourceResponse(mime, "utf-8", getAssets().open(name)); }
                catch (Exception e) { android.util.Log.e("StudyAssets", "Cannot load bundled asset: " + name, e); return new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0])); }
            }
            @Override public void onPageFinished(WebView view, String url) { webReady = true; signalInbox(); signalOverlayAction(); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage message) {
                android.util.Log.d("StudyWeb", message.message() + " at " + message.sourceId() + ":" + message.lineNumber()); return true;
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null); fileCallback = callback;
                boolean imagesOnly = params.getAcceptTypes().length > 0 && java.util.Arrays.stream(params.getAcceptTypes()).allMatch(type -> type.startsWith("image/"));
                Intent intent = imagesOnly && Build.VERSION.SDK_INT >= 33 ? new Intent(android.provider.MediaStore.ACTION_PICK_IMAGES).setType("image/*") : new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(imagesOnly ? "image/*" : "*/*");
                startActivityForResult(intent, 30); return true;
            }
        });
        web.loadUrl(ORIGIN + "/index.html");
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 90);
        receiveIntent(getIntent());
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); receiveIntent(intent); }
    void signalInbox() { if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('study-native-inbox'))", null); }
    void signalOverlayAction() {
        if (!webReady || pendingOverlayTool == null) return;
        String json = "{\"tool\":" + JSONObject.quote(pendingOverlayTool) + ",\"captureId\":" + JSONObject.quote(pendingCaptureId == null ? "" : pendingCaptureId) + "}";
        web.evaluateJavascript("window.studyPendingOverlayAction=" + json + ";window.dispatchEvent(new Event('study-overlay-action'))", null);
        pendingOverlayTool = null; pendingCaptureId = null;
    }
    void receiveIntent(Intent intent) {
        if ("overlay-capture-ready".equals(intent.getAction())) {
            getSystemService(android.app.NotificationManager.class).cancel(103);
            pendingOverlayTool = intent.getStringExtra("tool"); if (pendingOverlayTool == null) pendingOverlayTool = "capture";
            pendingCaptureId = intent.getStringExtra("captureId"); signalOverlayAction(); return;
        }
        if ("overlay-tool".equals(intent.getAction()) || "capture".equals(intent.getAction())) {
            captureTool = intent.getStringExtra("tool"); if (captureTool == null) captureTool = "capture";
            requestCapture(); return;
        }
        if (!Intent.ACTION_SEND.equals(intent.getAction()) && !Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) return;
        bridge.executor.execute(() -> {
            try {
                if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
                    ArrayList<Uri> uris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM); if (uris != null) for (Uri uri : uris) Inbox.receive(this, uri);
                } else {
                    Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                    if (uri != null) Inbox.receive(this, uri);
                    else { CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT); if (text != null) Inbox.save(this, new ByteArrayInputStream(text.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)), "分享文字.txt", "text/plain", null); }
                }
                runOnUiThread(() -> { Toast.makeText(this, "已接收分享，可在同步中心收取", Toast.LENGTH_LONG).show(); signalInbox(); });
            } catch (Exception e) { runOnUiThread(() -> Toast.makeText(this, "导入失败：" + e.getMessage(), Toast.LENGTH_LONG).show()); }
        });
    }
    void requestCapture() { requestCapture(captureTool); }
    void requestCapture(String tool) {
        if ("exam".equals(getSharedPreferences("context", MODE_PRIVATE).getString("mode", "study"))) { Toast.makeText(this, "考试模式不可截图", Toast.LENGTH_SHORT).show(); return; }
        captureTool = tool;
        MediaProjectionManager manager = getSystemService(MediaProjectionManager.class);
        Intent request = Build.VERSION.SDK_INT >= 34
            ? manager.createScreenCaptureIntent(android.media.projection.MediaProjectionConfig.createConfigForDefaultDisplay())
            : manager.createScreenCaptureIntent();
        startActivityForResult(request, 20);
    }
    void overlay(boolean enabled) {
        if (!enabled) { stopService(new Intent(this, OverlayService.class)); return; }
        if (!Settings.canDrawOverlays(this)) startActivityForResult(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())), 40);
        else startForegroundService(new Intent(this, OverlayService.class));
    }
    void record(JSONObject data) {
        Runnable start = () -> startForegroundService(new Intent(this, RecordService.class).putExtra("sessionId", data.optString("sessionId")).putExtra("courseId", data.optString("courseId")));
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) start.run();
        else { microphoneGranted = start; requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 50); }
    }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == 50) { if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED && microphoneGranted != null) microphoneGranted.run(); else Toast.makeText(this, "麦克风权限未授予", Toast.LENGTH_SHORT).show(); microphoneGranted = null; }
    }
    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == 20) {
            if (result == RESULT_OK && data != null) {
                OverlayService.setCaptureHidden(true);
                startForegroundService(new Intent(this, CaptureService.class).putExtra("resultCode", result).putExtra("resultData", data).putExtra("tool", captureTool));
                moveTaskToBack(true);
            } else {
                Toast.makeText(this, "已取消截图", Toast.LENGTH_SHORT).show();
            }
        }
        if (code == 30 && fileCallback != null) { fileCallback.onReceiveValue(result == RESULT_OK && data != null ? new Uri[]{data.getData()} : null); fileCallback = null; }
        if (code == 40 && Settings.canDrawOverlays(this)) startForegroundService(new Intent(this, OverlayService.class));
    }
    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
    @Override protected void onResume() { super.onResume(); foreground = true; OverlayService.setAppForeground(true); }
    @Override protected void onPause() { foreground = false; OverlayService.setAppForeground(false); super.onPause(); }
    @Override protected void onDestroy() { web.removeJavascriptInterface("StudyNative"); web.destroy(); bridge.executor.shutdown(); super.onDestroy(); }
}
