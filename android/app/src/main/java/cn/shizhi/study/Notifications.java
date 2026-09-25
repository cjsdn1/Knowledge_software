package cn.shizhi.study;
import android.app.*;
import android.content.*;

final class Notifications {
    static void captureReady(Context c, String tool, String captureId) {
        NotificationManager manager = c.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("study-results", "截图与处理结果", NotificationManager.IMPORTANCE_DEFAULT));
        Intent intent = new Intent(c, MainActivity.class).setAction("overlay-capture-ready")
            .putExtra("tool", tool).putExtra("captureId", captureId)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent open = PendingIntent.getActivity(c, 103, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        manager.notify(103, new Notification.Builder(c, "study-results").setSmallIcon(R.drawable.ic_study)
            .setContentTitle("拾知截图已保存").setContentText("点此圈选并选择工具")
            .setContentIntent(open).setAutoCancel(true).build());
    }
    static Notification create(Context c, String title, String message, Class<?> service, int id) {
        NotificationManager manager = c.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("study-capture", "学习记录", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(c, id, new Intent(c, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(c, id, new Intent(c, service).setAction("stop"), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(c, "study-capture").setSmallIcon(R.drawable.ic_study).setContentTitle(title).setContentText(message).setContentIntent(open).setOngoing(true).addAction(new Notification.Action.Builder(null, "停止", stop).build()).build();
    }
}
