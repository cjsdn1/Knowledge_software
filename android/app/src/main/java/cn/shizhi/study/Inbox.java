package cn.shizhi.study;

import android.content.Context;
import android.net.Uri;
import android.provider.OpenableColumns;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

final class Inbox {
    static final long MAX = 20L * 1024 * 1024;
    static File directory(Context c) { File dir = new File(c.getFilesDir(), "inbox"); dir.mkdirs(); return dir; }
    static String valid(String id) { if (!id.matches("[a-f0-9-]{36}")) throw new IllegalArgumentException("附件标识无效"); return id; }
    static File file(Context c, String id) { return new File(directory(c), valid(id) + ".bin"); }
    static synchronized JSONObject save(Context c, InputStream input, String name, String mime, JSONObject extras) throws Exception {
        String id = UUID.randomUUID().toString(); File file = file(c, id); long count = 0;
        try (InputStream in = input; OutputStream out = new FileOutputStream(file)) {
            byte[] bytes = new byte[65536]; int n;
            while ((n = in.read(bytes)) != -1) { count += n; if (count > MAX) throw new IOException("附件不能超过20 MB"); out.write(bytes, 0, n); }
        } catch (Exception e) { file.delete(); throw e; }
        JSONObject data = extras == null ? new JSONObject() : new JSONObject(extras.toString());
        data.put("id", id).put("name", name).put("mime", mime).put("size", count);
        try (FileOutputStream out = new FileOutputStream(new File(directory(c), id + ".json"))) { out.write(data.toString().getBytes(StandardCharsets.UTF_8)); out.getFD().sync(); }
        return data;
    }
    static void receive(Context c, Uri uri) throws Exception {
        String name = "分享附件", mime = c.getContentResolver().getType(uri);
        try (android.database.Cursor cursor = c.getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) { int col = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME); if (col >= 0) name = cursor.getString(col); }
        }
        save(c, c.getContentResolver().openInputStream(uri), name, mime == null ? "application/octet-stream" : mime, null);
    }
    static synchronized JSONArray list(Context c) throws Exception {
        JSONArray result = new JSONArray(); File[] files = directory(c).listFiles((d, n) -> n.endsWith(".json"));
        if (files != null) for (File f : files) { try (InputStream in = new FileInputStream(f)) { result.put(new JSONObject(new String(in.readAllBytes(), StandardCharsets.UTF_8))); } }
        return result;
    }
    static synchronized JSONObject update(Context c, String id, JSONObject changes) throws Exception {
        File metadata = new File(directory(c), valid(id) + ".json");
        JSONObject value;
        try (InputStream in = new FileInputStream(metadata)) { value = new JSONObject(new String(in.readAllBytes(), StandardCharsets.UTF_8)); }
        java.util.Iterator<String> keys = changes.keys();
        while (keys.hasNext()) { String key = keys.next(); value.put(key, changes.get(key)); }
        android.util.AtomicFile atomic = new android.util.AtomicFile(metadata);
        FileOutputStream out = atomic.startWrite();
        try { out.write(value.toString().getBytes(StandardCharsets.UTF_8)); atomic.finishWrite(out); }
        catch (Exception error) { atomic.failWrite(out); throw error; }
        return value;
    }
    static synchronized void acknowledge(Context c, String id) {
        // Called only after the web outbox has durably stored the file and associated event.
        File metadata = new File(directory(c), valid(id) + ".json");
        if (metadata.delete()) file(c, id).delete();
    }
}
