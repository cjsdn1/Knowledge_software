package cn.shizhi.study;

import android.app.Service;
import android.content.Intent;
import android.media.MediaRecorder;
import android.os.*;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.*;
import java.time.Instant;

public class RecordService extends Service {
    static RecordService active;
    private MediaRecorder recorder; private File segment; private String sessionId, courseId, startedAt; private long startedMs;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable rotate = () -> { finishSegment(); if (active == this) startSegment(); };
    @Override public int onStartCommand(Intent intent, int flags, int id) {
        if (intent == null || "stop".equals(intent.getAction())) { finish(); return START_NOT_STICKY; }
        if (active != null) return START_NOT_STICKY;
        sessionId = intent.getStringExtra("sessionId"); courseId = intent.getStringExtra("courseId");
        if (sessionId == null || sessionId.isEmpty()) { stopSelf(); return START_NOT_STICKY; }
        startForeground(103, Notifications.create(this, "拾知正在录音", "课堂录音会分段保存，可从通知栏停止", RecordService.class, 103));
        active = this;
        try { startSegment(); } catch (Exception e) { Toast.makeText(this, "录音无法启动：" + e.getMessage(), Toast.LENGTH_LONG).show(); finish(); }
        return START_NOT_STICKY;
    }
    private void startSegment() {
        try {
            segment = new File(Inbox.directory(this), "recording-" + System.currentTimeMillis() + ".m4a");
            recorder = new MediaRecorder(); recorder.setAudioSource(MediaRecorder.AudioSource.MIC); recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4); recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC); recorder.setAudioSamplingRate(44100); recorder.setAudioEncodingBitRate(96000); recorder.setOutputFile(segment.getAbsolutePath()); recorder.prepare(); recorder.start();
            startedAt = Instant.now().toString(); startedMs = System.currentTimeMillis(); handler.postDelayed(rotate, 4 * 60 * 1000);
        } catch (Exception e) { finish(); }
    }
    private void finishSegment() {
        handler.removeCallbacks(rotate); if (recorder == null) return;
        try { recorder.stop(); recorder.reset(); recorder.release(); recorder = null;
            if (segment.length() > 0) {
                JSONObject extra = new JSONObject().put("sessionId", sessionId).put("courseId", courseId).put("capturedAt", startedAt).put("durationMs", Math.min(360000, System.currentTimeMillis() - startedMs));
                Inbox.save(this, new FileInputStream(segment), "课堂录音-" + startedMs + ".m4a", "audio/mp4", extra);
            }
        } catch (Exception e) { if (recorder != null) { recorder.release(); recorder = null; } }
        finally { if (segment != null) segment.delete(); segment = null; }
    }
    void finish() { finishSegment(); active = null; stopSelf(); }
    @Override public void onDestroy() { finishSegment(); if (active == this) active = null; handler.removeCallbacksAndMessages(null); super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
