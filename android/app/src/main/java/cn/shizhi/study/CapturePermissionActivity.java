package cn.shizhi.study;

import android.app.Activity;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.widget.Toast;

/** A translucent, short-lived consent host; the study WebView never comes to the foreground. */
public class CapturePermissionActivity extends Activity {
    private boolean captureStarted;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) return;
        if ("exam".equals(getSharedPreferences("context", MODE_PRIVATE).getString("mode", "study"))) {
            Toast.makeText(this, "考试模式不可截图", Toast.LENGTH_SHORT).show(); finishAndRemoveTask(); return;
        }
        OverlayService.setCaptureHidden(true);
        MediaProjectionManager projection = getSystemService(MediaProjectionManager.class);
        Intent request = Build.VERSION.SDK_INT >= 34
            ? projection.createScreenCaptureIntent(android.media.projection.MediaProjectionConfig.createConfigForDefaultDisplay())
            : projection.createScreenCaptureIntent();
        startActivityForResult(request, 20);
    }
    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != 20) return;
        if (result == RESULT_OK && data != null) {
            captureStarted = true;
            startForegroundService(new Intent(this, CaptureService.class)
                .putExtra("resultCode", result).putExtra("resultData", data)
                .putExtra("tool", getIntent().getStringExtra("tool"))
                .putExtra("overlayOnly", true));
        } else { OverlayService.setCaptureHidden(false); OverlayService.captureDenied(); }
        finishAndRemoveTask();
    }
    @Override protected void onDestroy() { if (!captureStarted) OverlayService.setCaptureHidden(false); super.onDestroy(); }
}
