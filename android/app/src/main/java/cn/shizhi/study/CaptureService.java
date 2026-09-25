package cn.shizhi.study;

import android.app.Service;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.Point;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.*;
import android.view.WindowManager;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

public class CaptureService extends Service {
    private HandlerThread thread; private Handler handler; private MediaProjection projection; private ImageReader reader; private VirtualDisplay display; private boolean captured;
    @Override public int onStartCommand(Intent intent, int flags, int id) {
        if (intent == null || "stop".equals(intent.getAction())) { stopSelf(); return START_NOT_STICKY; }
        startForeground(102, Notifications.create(this, "拾知正在截图", "仅获取本次授权的一张截图", CaptureService.class, 102));
        thread = new HandlerThread("study-single-capture"); thread.start(); handler = new Handler(thread.getLooper());
        try {
            android.util.DisplayMetrics m = getResources().getDisplayMetrics();
            Point size = new Point();
            if (Build.VERSION.SDK_INT >= 30) {
                try {
                    Rect bounds = getSystemService(WindowManager.class).getMaximumWindowMetrics().getBounds();
                    size.set(bounds.width(), bounds.height());
                } catch (RuntimeException ignored) { /* Fall back to real display bounds below. */ }
            }
            Point realSize = new Point(); getSystemService(WindowManager.class).getDefaultDisplay().getRealSize(realSize);
            if (realSize.x * (long) realSize.y > size.x * (long) size.y) size = realSize;
            int width = size.x, height = size.y;
            reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
            reader.setOnImageAvailableListener(r -> {
                if (captured) return; Image image = r.acquireLatestImage(); if (image == null) return;
                captured = true;
                try {
                    Image.Plane plane = image.getPlanes()[0]; ByteBuffer buffer = plane.getBuffer(); int stride = plane.getRowStride(), pixel = plane.getPixelStride();
                    Bitmap padded = Bitmap.createBitmap(width + (stride - pixel * width) / pixel, height, Bitmap.Config.ARGB_8888);
                    padded.copyPixelsFromBuffer(buffer);
                    Bitmap crop = Bitmap.createBitmap(padded, 0, 0, width, height);
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    crop.compress(Bitmap.CompressFormat.PNG, 100, out);
                    boolean lossless = out.size() <= Inbox.MAX;
                    if (!lossless) {
                        for (int quality : new int[]{96, 92, 88}) {
                            out.reset(); crop.compress(Bitmap.CompressFormat.JPEG, quality, out);
                            if (out.size() <= Inbox.MAX) break;
                        }
                        Bitmap scaled = crop;
                        try {
                            while (out.size() > Inbox.MAX && Math.max(scaled.getWidth(), scaled.getHeight()) > 800) {
                                Bitmap smaller = Bitmap.createScaledBitmap(scaled, Math.max(1, Math.round(scaled.getWidth() * .8f)), Math.max(1, Math.round(scaled.getHeight() * .8f)), true);
                                if (scaled != crop) scaled.recycle();
                                scaled = smaller; out.reset(); scaled.compress(Bitmap.CompressFormat.JPEG, 88, out);
                            }
                        } finally { if (scaled != crop) scaled.recycle(); }
                    }
                    String extension = lossless ? ".png" : ".jpg", mime = lossless ? "image/png" : "image/jpeg";
                    JSONObject saved = Inbox.save(this, new ByteArrayInputStream(out.toByteArray()), "屏幕截图-" + System.currentTimeMillis() + extension, mime, new JSONObject().put("kind", "capture"));
                    crop.recycle(); padded.recycle();
                    String captureId = saved.getString("id"), tool = intent.getStringExtra("tool");
                    new Handler(Looper.getMainLooper()).post(() -> {
                        OverlayService.setCaptureHidden(false);
                        if (intent.getBooleanExtra("overlayOnly", false) && OverlayService.active != null) {
                            OverlayService.active.showCapture(captureId, tool);
                            return;
                        }
                        try { Notifications.captureReady(this, tool, captureId); }
                        catch (Exception ignored) { /* Notifications may be disabled by the user. */ }
                        try {
                            startActivity(new Intent(this, MainActivity.class).setAction("overlay-capture-ready")
                                .putExtra("tool", tool).putExtra("captureId", captureId)
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
                        } catch (Exception ignored) { /* Notification and the in-app inbox remain available. */ }
                    });
                } catch (Exception e) { new Handler(Looper.getMainLooper()).post(() -> Toast.makeText(this, "截图失败：" + e.getMessage(), Toast.LENGTH_LONG).show()); }
                finally { image.close(); OverlayService.setCaptureHidden(false); stopSelf(); }
            }, handler);
            MediaProjectionManager pm = getSystemService(MediaProjectionManager.class);
            projection = pm.getMediaProjection(intent.getIntExtra("resultCode", 0), intent.getParcelableExtra("resultData"));
            if (projection == null) throw new IllegalStateException("未取得屏幕授权");
            projection.registerCallback(new MediaProjection.Callback() { @Override public void onStop() { stopSelf(); } }, handler);
            // Give the task a moment to move behind the source app after consent, so we do not capture our own UI.
            handler.postDelayed(() -> {
                try { display = projection.createVirtualDisplay("study-once", width, height, m.densityDpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.getSurface(), null, handler); }
                catch (Exception e) { new Handler(Looper.getMainLooper()).post(() -> Toast.makeText(this, "截图失败：" + e.getMessage(), Toast.LENGTH_LONG).show()); stopSelf(); }
            }, 450);
            handler.postDelayed(this::stopSelf, 12000);
        } catch (Exception e) { stopSelf(); }
        return START_NOT_STICKY;
    }
    @Override public void onDestroy() { OverlayService.setCaptureHidden(false); if (display != null) display.release(); if (reader != null) reader.close(); if (projection != null) projection.stop(); if (thread != null) thread.quitSafely(); super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
