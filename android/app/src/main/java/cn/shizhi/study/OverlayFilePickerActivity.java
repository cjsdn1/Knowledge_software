package cn.shizhi.study;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/** Keeps the overlay panel in place while Android's document picker is open. */
public class OverlayFilePickerActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) return;
        OverlayService.setCaptureHidden(true);
        boolean image = getIntent().getBooleanExtra("image", false);
        Intent request = image && android.os.Build.VERSION.SDK_INT >= 33
            ? new Intent(android.provider.MediaStore.ACTION_PICK_IMAGES).setType("image/*")
            : new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(image ? "image/*" : "*/*");
        request.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(request, 1);
    }
    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        OverlayService.setCaptureHidden(false);
        if (code == 1 && result == RESULT_OK && data != null && data.getData() != null) OverlayService.documentPicked(data.getData());
        finishAndRemoveTask();
    }
    @Override protected void onDestroy() { OverlayService.setCaptureHidden(false); super.onDestroy(); }
}
