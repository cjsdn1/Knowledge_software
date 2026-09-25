package cn.shizhi.study;

import android.app.Service;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class OverlayService extends Service {
    static OverlayService active;
    private WindowManager manager;
    private View bubble, menu, panel;
    private OverlayToolPanel toolPanel;
    private Bitmap previewBitmap;
    private String visibleJobId;
    private String selectedMenuTool = "explain";
    private String visibleTool = "explain", visibleInput = "";
    private String visibleKind = "capture";
    private String lastTitle = "", lastDetail = "";
    private String draftAttachmentId = "", draftAttachmentName = "";
    private String draftInput = "";
    private boolean inputBusy;
    private int wordLookupSequence;
    private boolean openedFromApp, draftImage;
    private boolean captureHidden, appForeground;
    private TextView statusText;
    private WindowManager.LayoutParams bubbleParams;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService jobs = Executors.newSingleThreadExecutor();
    private final Set<String> inFlight = ConcurrentHashMap.newKeySet();
    private final Runnable retryPending = new Runnable() {
        @Override public void run() { resumePending(); handler.postDelayed(this, 30000); }
    };

    private int dp(int value) { return (int) (value * getResources().getDisplayMetrics().density + .5f); }
    private GradientDrawable shape(int color, int radius) {
        GradientDrawable drawable = new GradientDrawable(); drawable.setColor(color); drawable.setCornerRadius(dp(radius)); return drawable;
    }
    static void setCaptureHidden(boolean hidden) {
        OverlayService service = active;
        if (service == null) return;
        Runnable update = () -> {
            service.captureHidden = hidden;
            service.updateVisibility();
        };
        if (Looper.myLooper() == Looper.getMainLooper()) update.run(); else service.handler.post(update);
    }
    static void setAppForeground(boolean foreground) {
        OverlayService service = active;
        if (service == null) return;
        service.handler.post(() -> { service.appForeground = foreground; service.updateVisibility(); });
    }
    private void updateVisibility() {
        boolean hidden = captureHidden || (appForeground && !openedFromApp);
        if (bubble != null) bubble.setVisibility(hidden || panel != null ? View.GONE : View.VISIBLE);
        if (menu != null) menu.setVisibility(hidden ? View.GONE : View.VISIBLE);
        if (panel != null) panel.setVisibility(hidden ? View.GONE : View.VISIBLE);
    }
    static void captureDenied() {
        OverlayService service = active;
        if (service != null) service.handler.post(() -> service.showStatus("截图已取消", "未保存或上传任何新内容。", null));
    }
    private void launch(String tool) {
        closeMenu();
        if ("recent".equals(tool)) { showRecentCapture(); return; }
        Intent intent = "open".equals(tool) ? new Intent(this, MainActivity.class) : new Intent(this, CapturePermissionActivity.class).putExtra("tool", tool);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION);
        startActivity(intent);
    }
    private void closeMenu() { if (menu != null) { manager.removeView(menu); menu = null; } }
    private void toggleMenu() {
        if (toolPanel != null) { closePanel(); return; }
        OverlayToolPanel view = new OverlayToolPanel(this, new OverlayToolPanel.Listener() {
            @Override public void lookupWord(String word) {
                if (word.trim().isEmpty() || word.length() > 160) return;
                final OverlayToolPanel target = toolPanel;
                final int sequence = ++wordLookupSequence;
                target.showWordOutput(word, "正在查询…");
                java.util.concurrent.CompletableFuture.runAsync(() -> {
                    String result;
                    try { result = OverlayJobs.lookupWord(OverlayService.this, word); }
                    catch (Exception error) {
                        result = error instanceof java.io.IOException
                            ? "暂时无法连接电脑，请启动电脑端并检查两端连接，再点词重试。"
                            : "查询失败：" + error.getMessage() + "\n可再次点词重试。";
                    }
                    final String detail = result;
                    handler.post(() -> { if (toolPanel == target && sequence == wordLookupSequence) target.showWordOutput(word, detail); });
                });
            }
            @Override public void process(String tool, String input, String attachmentId) { submitInput(tool, input, attachmentId); }
            @Override public void capture(String tool) { selectedMenuTool = tool; draftInput = toolPanel.currentInput(); launch(tool); }
            @Override public void pickImage() { startActivity(new Intent(OverlayService.this, OverlayFilePickerActivity.class).putExtra("image", true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
            @Override public void pickFile() { startActivity(new Intent(OverlayService.this, OverlayFilePickerActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
            @Override public void removeAttachment(String id) { if (id.equals(draftAttachmentId)) { Inbox.acknowledge(OverlayService.this, id); draftAttachmentId = ""; draftAttachmentName = ""; } }
            @Override public void close() { selectedMenuTool = toolPanel.currentTool(); draftInput = toolPanel.currentInput(); openedFromApp = false; closePanel(); }
        }, selectedMenuTool);
        showPanel(view);
        view.setInput(draftInput);
        if (!draftAttachmentId.isEmpty()) { view.setAttachment(draftAttachmentId, draftAttachmentName); if (draftImage) view.setImageFile(Inbox.file(this, draftAttachmentId)); }
        if (!lastTitle.isEmpty()) view.showOutput(lastTitle, lastDetail);
        view.setBusy(inputBusy);
    }
    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(color);
        view.setPadding(dp(6), dp(7), dp(6), dp(7)); return view;
    }
    private TextView action(String value, Runnable run) {
        TextView view = text(value, 14, 0xffffffff); view.setGravity(Gravity.CENTER);
        view.setBackground(shape(0xff376454, 10)); view.setOnClickListener(v -> run.run()); return view;
    }
    private void closePanel() {
        if (panel != null) { manager.removeView(panel); panel = null; }
        // Window removal is asynchronous; its last frame may still reference this bitmap.
        // Let GC release it after the detached crop view and renderer are finished.
        previewBitmap = null;
        statusText = null; toolPanel = null;
        updateVisibility();
    }
    private void showPanel(View view) {
        closePanel(); closeMenu(); panel = view;
        toolPanel = view instanceof OverlayToolPanel ? (OverlayToolPanel) view : null;
        int width = getResources().getDisplayMetrics().widthPixels, height = getResources().getDisplayMetrics().heightPixels;
        int panelHeight = toolPanel == null ? WindowManager.LayoutParams.WRAP_CONTENT : Math.min(height - dp(120), dp(520));
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(Math.min(width - dp(24), dp(390)), panelHeight,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL, PixelFormat.TRANSLUCENT);
        params.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE;
        params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL; params.y = dp(48);
        if (toolPanel != null) view.setOnApplyWindowInsetsListener((target, insets) -> {
            int keyboard = Build.VERSION.SDK_INT >= 30 ? insets.getInsets(WindowInsets.Type.ime()).bottom : insets.getSystemWindowInsetBottom();
            int available = height - keyboard - dp(100);
            int desired = Math.max(dp(220), Math.min(panelHeight, available));
            if (params.height != desired && panel == target) {
                params.height = desired;
                target.post(() -> { if (panel == target && target.isAttachedToWindow()) manager.updateViewLayout(target, params); });
            }
            return insets;
        });
        manager.addView(panel, params);
        updateVisibility();
    }
    private void submitInput(String tool, String input, String attachmentId) {
        try {
            if (inputBusy) throw new IllegalStateException("当前任务仍在处理，请等待结果。");
            String courseId = getSharedPreferences("context", MODE_PRIVATE).getString("courseId", "");
            if (courseId.isEmpty()) throw new IllegalStateException("请先在拾知主应用选择课程并配对电脑。");
            if ("exam".equals(getSharedPreferences("context", MODE_PRIVATE).getString("mode", "study"))) throw new IllegalStateException("考试模式不可提交新内容。");
            if ("calculator".equals(tool) && !attachmentId.isEmpty()) throw new IllegalStateException("计算器仅处理算式，请移除文档或选择其他工具。");
            if (input.isEmpty() && attachmentId.isEmpty()) throw new IllegalStateException("请先输入文字或添加文档。");
            if (input.length() > 55000) throw new IllegalStateException("文字过长，请缩短后提交。");
            String jobId = UUID.randomUUID().toString(), id;
            JSONObject changes = new JSONObject().put("kind", attachmentId.isEmpty() ? "overlay-text-job" : draftImage ? "overlay-job" : "overlay-document-job")
                .put("noteId", UUID.randomUUID().toString()).put("syncId", UUID.randomUUID().toString())
                .put("tool", tool).put("jobId", jobId).put("courseId", courseId).put("input", input);
            if (attachmentId.isEmpty()) {
                JSONObject saved = Inbox.save(this, new ByteArrayInputStream(input.getBytes(StandardCharsets.UTF_8)),
                    "悬浮输入.txt", "text/plain", changes); id = saved.getString("id");
            } else { Inbox.update(this, attachmentId, changes); id = attachmentId; draftAttachmentId = ""; draftAttachmentName = ""; toolPanel.setAttachment("", ""); }
            selectedMenuTool = tool; draftInput = input; visibleTool = tool; visibleInput = input; visibleKind = "input"; visibleJobId = jobId;
            inputBusy = true; toolPanel.setBusy(true);
            showToolResult("已保存到本机", "正在发送并处理；断线时内容会保留并自动重试。");
            enqueue(id, jobId);
        } catch (Exception error) { if (toolPanel != null) toolPanel.showOutput("无法提交", error.getMessage()); }
    }
    private void showToolResult(String title, String detail) {
        lastTitle = title; lastDetail = detail;
        if (toolPanel != null) toolPanel.showOutput(title, detail);
    }
    private String formattedResult(String body) {
        if ("translate".equals(visibleTool) && !visibleInput.isEmpty())
            return "原文\n" + visibleInput.substring(0, Math.min(visibleInput.length(), 500)) + "\n\n译文与解析\n" + body;
        if ("calculator".equals(visibleTool) && !visibleInput.isEmpty()) return "算式\n" + visibleInput + "\n\n计算结果\n" + body;
        return body;
    }
    static void documentPicked(Uri uri) {
        OverlayService service = active;
        if (service == null || uri == null) return;
        service.jobs.execute(() -> {
            try {
                String name = "导入文档", mime = service.getContentResolver().getType(uri);
                try (android.database.Cursor cursor = service.getContentResolver().query(uri, null, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) { int column = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME); if (column >= 0) name = cursor.getString(column); }
                }
                String filename = name;
                boolean image = mime != null && mime.startsWith("image/");
                if (!image && !filename.toLowerCase(java.util.Locale.ROOT).matches(".*\\.(pdf|pptx|txt|md)$"))
                    throw new IllegalStateException("支持 PDF、PPTX、TXT 和 Markdown；图片请使用截屏按钮，旧版 PPT 请另存为 PPTX。");
                try (InputStream stream = service.getContentResolver().openInputStream(uri)) {
                    JSONObject saved = Inbox.save(service, stream, filename, mime == null ? "application/octet-stream" : mime,
                        new JSONObject().put("kind", "overlay-document-draft"));
                    service.handler.post(() -> {
                        if (!service.draftAttachmentId.isEmpty()) Inbox.acknowledge(service, service.draftAttachmentId);
                        service.draftImage = image;
                        service.draftAttachmentId = saved.optString("id"); service.draftAttachmentName = filename;
                        if (service.toolPanel != null) { service.toolPanel.setAttachment(service.draftAttachmentId, filename); if (image) service.toolPanel.setImageFile(Inbox.file(service, service.draftAttachmentId)); }
                    });
                }
            } catch (Exception error) { service.handler.post(() -> { if (service.toolPanel != null) service.toolPanel.showOutput("文档导入失败", error.getMessage()); }); }
        });
    }
    void showCapture(String id, String tool) {
        if (Looper.myLooper() != Looper.getMainLooper()) { handler.post(() -> showCapture(id, tool)); return; }
        try {
            Bitmap bitmap = BitmapFactory.decodeFile(Inbox.file(this, id).getAbsolutePath());
            if (bitmap == null) throw new IllegalStateException("截图文件不可用。");
            OverlayCaptureView view = new OverlayCaptureView(this, bitmap, tool, new OverlayCaptureView.Listener() {
                @Override public void discard() { Inbox.acknowledge(OverlayService.this, id); visibleJobId = null; closePanel(); }
                @Override public void send(OverlayCaptureView.EncodedImage image, String selectedTool) {
                    try {
                        String courseId = getSharedPreferences("context", MODE_PRIVATE).getString("courseId", "");
                        if (courseId.isEmpty()) throw new IllegalStateException("请先在拾知主应用选择课程并配对电脑。");
                        if ("exam".equals(getSharedPreferences("context", MODE_PRIVATE).getString("mode", "study"))) throw new IllegalStateException("考试模式不可上传截图。");
                        String jobId = UUID.randomUUID().toString();
                        String extension = "image/png".equals(image.mime) ? ".png" : ".jpg";
                        JSONObject saved = Inbox.save(OverlayService.this, new ByteArrayInputStream(image.data),
                            "圈选截图-" + System.currentTimeMillis() + extension, image.mime,
                            new JSONObject().put("kind", "overlay-job").put("tool", selectedTool).put("jobId", jobId)
                                .put("noteId", UUID.randomUUID().toString()).put("syncId", UUID.randomUUID().toString()).put("courseId", courseId));
                        Inbox.acknowledge(OverlayService.this, id);
                        visibleJobId = jobId; visibleKind = "input"; visibleInput = draftInput; visibleTool = selectedTool; selectedMenuTool = selectedTool;
                        inputBusy = true; toggleMenu();
                        showToolResult("处理中", "正在上传选区…");
                        enqueue(saved.getString("id"), jobId);
                    } catch (Exception error) { showStatus("打包失败", error.getMessage(), null); }
                }
            });
            showPanel(view); previewBitmap = bitmap;
        } catch (Exception error) { showStatus("截图不可用", error.getMessage(), null); }
    }
    private void showRecentCapture() {
        try {
            JSONArray items = Inbox.list(this);
            for (int i = items.length() - 1; i >= 0; i--) {
                JSONObject item = items.getJSONObject(i);
                if ("capture".equals(item.optString("kind"))) { showCapture(item.getString("id"), "capture"); return; }
            }
            showStatus("没有待圈选截图", "长按悬浮球或选择一个工具开始截图。", null);
        } catch (Exception error) { showStatus("读取截图失败", error.getMessage(), null); }
    }
    private void showStatus(String title, String detail, String retryId) {
        if (Looper.myLooper() != Looper.getMainLooper()) { handler.post(() -> showStatus(title, detail, retryId)); return; }
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(dp(16), dp(15), dp(16), dp(15));
        root.setBackground(shape(0xfffbfcf8, 18)); root.setElevation(dp(12));
        TextView heading = text(title, 17, 0xff173b2d); heading.setPadding(0, 0, 0, dp(12)); root.addView(heading);
        ScrollView scroll = new ScrollView(this); scroll.setBackground(shape(0xffedf2ed, 11));
        TextView body = text(detail, 14, 0xff254034); body.setTextIsSelectable(true); body.setPadding(dp(12), dp(11), dp(12), dp(11)); scroll.addView(body);
        int contentWidth = Math.min(getResources().getDisplayMetrics().widthPixels - dp(56), dp(350));
        body.measure(View.MeasureSpec.makeMeasureSpec(contentWidth, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
        int bodyHeight = Math.max(dp(66), Math.min(body.getMeasuredHeight(), Math.min(dp(260), getResources().getDisplayMetrics().heightPixels / 3)));
        root.addView(scroll, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, bodyHeight));
        LinearLayout buttons = new LinearLayout(this);
        if (retryId != null) {
            TextView retry = action("立即重试", () -> enqueue(retryId, visibleJobId));
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, dp(42), 1); p.rightMargin = dp(8); buttons.addView(retry, p);
        }
        TextView close = action("收起", () -> { visibleJobId = null; closePanel(); });
        buttons.addView(close, new LinearLayout.LayoutParams(0, dp(42), 1));
        LinearLayout.LayoutParams actions = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(42)); actions.topMargin = dp(13);
        root.addView(buttons, actions); showPanel(root); statusText = body;
    }
    private void enqueue(String id, String jobId) {
        if (id == null || jobId == null || !inFlight.add(id)) return;
        jobs.execute(() -> {
            try {
                JSONObject result = OverlayJobs.process(this, id, message -> handler.post(() -> {
                    if (!jobId.equals(visibleJobId)) return;
                    if (toolPanel != null) showToolResult("处理中", message);
                    else if (statusText != null) statusText.setText(message);
                }));
                handler.post(() -> {
                    if (!jobId.equals(visibleJobId)) return;
                    JSONObject run = result.optJSONObject("run");
                    String body = run == null ? result.optString("error", "处理未完成。") : run.optString("output", "") +
                        (run.optString("error").isEmpty() ? "" : "\n\n处理未完成：" + run.optString("error"));
                    if (body.isEmpty()) body = "任务状态：" + result.optString("status");
                    if ("input".equals(visibleKind)) {
                        inputBusy = false; if (toolPanel != null) toolPanel.setBusy(false);
                        showToolResult("done".equals(result.optString("status")) ? "处理完成 · 已同步应用" : "处理未完成", formattedResult(body));
                    } else showStatus("done".equals(result.optString("status")) ? "处理完成 · 已归入课程笔记" : "处理未完成 · 截图已归档", body, null);
                });
            } catch (Exception error) {
                handler.post(() -> { if (jobId.equals(visibleJobId)) {
                    if ("input".equals(visibleKind)) { inputBusy = false; if (toolPanel != null) toolPanel.setBusy(false); showToolResult("等待连接电脑", error.getMessage() + "\n内容仍保留在手机，将自动重试。"); }
                    else showStatus("等待连接电脑", error.getMessage() + "\n截图和任务仍保留在手机，将自动重试。", id);
                } });
            } finally { inFlight.remove(id); }
        });
    }
    private void resumePending() {
        try {
            JSONArray items = Inbox.list(this);
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.getJSONObject(i);
                if (item.optString("kind").equals("overlay-job") || item.optString("kind").equals("overlay-text-job") || item.optString("kind").equals("overlay-document-job")) enqueue(item.getString("id"), item.getString("jobId"));
            }
        } catch (Exception ignored) { /* Keep the service alive; next retry can recover. */ }
    }
    @Override public void onCreate() {
        super.onCreate();
        if (!Settings.canDrawOverlays(this)) { stopSelf(); return; }
        startForeground(101, Notifications.create(this, "拾知悬浮入口", "轻点选工具，长按截图；可从通知栏停止", OverlayService.class, 101));
        manager = getSystemService(WindowManager.class);
        TextView view = new TextView(this); view.setText("✦"); view.setTextColor(0xffffffff); view.setTextSize(25); view.setGravity(Gravity.CENTER);
        view.setBackground(shape(0xff376454, 16)); view.setElevation(dp(8));
        int size = dp(56), width = getResources().getDisplayMetrics().widthPixels;
        bubbleParams = new WindowManager.LayoutParams(size, size, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL, PixelFormat.TRANSLUCENT);
        bubbleParams.gravity = Gravity.TOP | Gravity.LEFT; bubbleParams.x = width - size - dp(16);
        bubbleParams.y = getResources().getDisplayMetrics().heightPixels / 3;
        view.setOnTouchListener(new View.OnTouchListener() {
            float downX, downY; int initialX, initialY; boolean held, moved;
            final Runnable longPress = () -> { held = true; launch("capture"); };
            @Override public boolean onTouch(View v, MotionEvent e) {
                switch (e.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        downX = e.getRawX(); downY = e.getRawY(); initialX = bubbleParams.x; initialY = bubbleParams.y;
                        held = false; moved = false; handler.postDelayed(longPress, 600); return true;
                    case MotionEvent.ACTION_MOVE:
                        int dx = (int) (e.getRawX() - downX), dy = (int) (e.getRawY() - downY);
                        if (Math.abs(dx) + Math.abs(dy) > dp(8)) { moved = true; handler.removeCallbacks(longPress); }
                        if (moved) {
                            int maxX = Math.max(0, getResources().getDisplayMetrics().widthPixels - size);
                            int maxY = Math.max(dp(24), getResources().getDisplayMetrics().heightPixels - size - dp(40));
                            bubbleParams.x = Math.max(0, Math.min(maxX, initialX + dx));
                            bubbleParams.y = Math.max(dp(24), Math.min(maxY, initialY + dy));
                            manager.updateViewLayout(bubble, bubbleParams); closeMenu();
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        handler.removeCallbacks(longPress); if (!held && !moved) toggleMenu(); return true;
                    case MotionEvent.ACTION_CANCEL: handler.removeCallbacks(longPress); return true;
                }
                return false;
            }
        });
        bubble = view; manager.addView(bubble, bubbleParams); active = this;
        appForeground = MainActivity.foreground; updateVisibility();
        handler.postDelayed(retryPending, 2500);
    }
    @Override public int onStartCommand(Intent intent, int flags, int id) {
        if (intent != null && "stop".equals(intent.getAction())) { stopSelf(); return START_NOT_STICKY; }
        if (intent != null && "show-panel".equals(intent.getAction()) && active != null) {
            openedFromApp = true; selectedMenuTool = intent.getStringExtra("tool");
            if (toolPanel == null) toggleMenu(); else updateVisibility();
        }
        return Settings.canDrawOverlays(this) ? START_STICKY : START_NOT_STICKY;
    }
    @Override public void onDestroy() {
        if (active == this) active = null;
        if (!draftAttachmentId.isEmpty()) Inbox.acknowledge(this, draftAttachmentId);
        closePanel(); closeMenu(); if (bubble != null) manager.removeView(bubble);
        handler.removeCallbacksAndMessages(null); jobs.shutdownNow(); super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
