package cn.shizhi.study;

import android.content.Context;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Persisted, resumable crop upload followed by an idempotent PC job. No model key resides on the phone. */
final class OverlayJobs {
    interface Progress { void update(String text); }
    static String lookupWord(Context context, String word) throws Exception {
        Vault vault = new Vault(context);
        if (vault.base().isEmpty() || vault.token().isEmpty()) throw new IllegalStateException("请连接电脑后再查词。");
        if (!vault.serverId().equals(call(vault, "GET", "/api/connection", null).optString("serverId"))) throw new IllegalStateException("请重新配对电脑。");
        String courseId = context.getSharedPreferences("context", Context.MODE_PRIVATE).getString("courseId", "");
        JSONObject result = call(vault, "POST", "/api/run", new JSONObject().put("courseId", courseId)
            .put("steps", new JSONArray().put("dictionary")).put("input", word).put("request", "查询选中词语的读音、词性、释义和例句"));
        if (!"done".equals(result.optString("status"))) throw new IllegalStateException(result.optString("error", "查词未完成，请重试。"));
        return result.optString("output", "未找到释义。");
    }
    private static String address(String base) throws Exception {
        URI uri = new URI(base.trim());
        if (uri.getUserInfo() != null || uri.getHost() == null || uri.getQuery() != null || uri.getFragment() != null || !(uri.getPath().isEmpty() || uri.getPath().equals("/")))
            throw new IllegalArgumentException("电脑地址无效，请重新配对。");
        if (!"https".equals(uri.getScheme()) && !("http".equals(uri.getScheme()) && (InetAddress.getByName(uri.getHost()).isSiteLocalAddress() || InetAddress.getByName(uri.getHost()).isLoopbackAddress())))
            throw new IllegalArgumentException("异网连接必须使用 HTTPS。");
        return base.trim().replaceAll("/+$", "");
    }
    private static JSONObject call(Vault vault, String method, String path, JSONObject body) throws Exception {
        if (!path.startsWith("/api/") || path.contains("..") || path.contains("\\") || path.contains("#")) throw new IllegalArgumentException("接口路径无效。");
        HttpURLConnection connection = (HttpURLConnection) new URL(address(vault.base()) + path).openConnection();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(10000); connection.setReadTimeout(30000);
        connection.setRequestMethod(method); connection.setRequestProperty("Authorization", "Bearer " + vault.token());
        try {
            if (body != null) {
                connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json");
                try (OutputStream out = connection.getOutputStream()) { out.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
            }
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) throw new IllegalStateException("电脑连接发生跳转，已拒绝发送数据。");
            InputStream raw = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            JSONObject result;
            try (InputStream in = raw) { result = in == null ? new JSONObject() : new JSONObject(new String(in.readAllBytes(), StandardCharsets.UTF_8)); }
            if (status < 200 || status >= 300) throw new IllegalStateException(result.optString("error", "电脑返回 " + status));
            return result;
        } finally { connection.disconnect(); }
    }
    private static byte[] bytes(File file, long limit) throws Exception {
        if (!file.isFile() || file.length() < 1 || file.length() > limit) throw new IllegalStateException("附件不存在或过大，请重新选择。");
        try (InputStream in = new FileInputStream(file)) { return in.readAllBytes(); }
    }
    private static String sha256(byte[] data) throws Exception {
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(data); StringBuilder result = new StringBuilder();
        for (byte b : hash) result.append(String.format(java.util.Locale.ROOT, "%02x", b & 255)); return result.toString();
    }
    private static boolean received(JSONArray values, int index) { for (int i = 0; i < values.length(); i++) if (values.optInt(i, -1) == index) return true; return false; }
    private static JSONArray steps(String tool) {
        JSONArray list = new JSONArray(); list.put("ocr");
        if ("note".equals(tool)) list.put("save");
        else if ("capture".equals(tool) || "formula".equals(tool)) list.put("explain");
        else list.put(tool);
        return list;
    }
    private static JSONArray inputSteps(String tool) {
        JSONArray list = new JSONArray();
        if (!"note".equals(tool)) list.put("formula".equals(tool) ? "explain" : tool);
        list.put("save");
        return list;
    }
    private static String label(String tool) {
        for (String[] pair : OverlayCaptureView.TOOLS) if (pair[0].equals(tool)) return pair[1];
        return "解释";
    }
    static JSONObject process(Context context, String id, Progress progress) throws Exception {
        Vault vault = new Vault(context);
        if (vault.base().isEmpty() || vault.token().isEmpty()) throw new IllegalStateException("请先在拾知主应用中配对电脑。");
        JSONObject meta = null;
        JSONArray items = Inbox.list(context);
        for (int i = 0; i < items.length(); i++) if (id.equals(items.getJSONObject(i).optString("id"))) { meta = items.getJSONObject(i); break; }
        if (meta == null) throw new IllegalStateException("本机待传任务已不存在。");
        String kind = meta.optString("kind");
        if ("overlay-text-job".equals(kind) || "overlay-document-job".equals(kind)) return processInput(context, vault, id, meta, progress);
        if (!"overlay-job".equals(kind)) throw new IllegalStateException("任务类型无效。");
        String courseId = meta.getString("courseId"), tool = meta.getString("tool"), jobId = meta.getString("jobId");
        String mime = meta.optString("mime", "image/jpeg");
        if (!"image/png".equals(mime) && !"image/jpeg".equals(mime)) throw new IllegalStateException("截图格式无效，请重新截图。");
        String noteId = meta.getString("noteId"), syncId = meta.getString("syncId");
        progress.update("正在核对电脑身份…");
        if (!vault.serverId().equals(call(vault, "GET", "/api/connection", null).optString("serverId"))) throw new IllegalStateException("电脑身份已改变，请重新配对。截图仍保留在本机。");
        String fileId = meta.optString("fileId", "");
        if (fileId.isEmpty()) {
            byte[] image = bytes(Inbox.file(context, id), 8L * 1024 * 1024);
            progress.update("正在上传圈选截图…");
            JSONObject upload = call(vault, "POST", "/api/uploads", new JSONObject()
                .put("clientId", id).put("kind", "media").put("courseId", courseId)
                .put("name", "悬浮圈选-" + id + ("image/png".equals(mime) ? ".png" : ".jpg")).put("mime", mime)
                .put("size", image.length).put("sha256", sha256(image)));
            if ("done".equals(upload.optString("status"))) fileId = upload.getJSONObject("result").getString("id");
            else {
                int chunkSize = upload.getInt("chunkSize"), count = (image.length + chunkSize - 1) / chunkSize;
                JSONArray prior = upload.getJSONArray("received");
                for (int i = 0; i < count; i++) {
                    if (!received(prior, i)) {
                        int offset = i * chunkSize, length = Math.min(chunkSize, image.length - offset);
                        String encoded = Base64.encodeToString(image, offset, length, Base64.NO_WRAP);
                        call(vault, "PUT", "/api/uploads/" + id + "/chunks/" + i, new JSONObject().put("data", encoded));
                    }
                    progress.update("截图上传 " + Math.round((i + 1) * 100f / count) + "%");
                }
                fileId = call(vault, "POST", "/api/uploads/" + id + "/complete", new JSONObject()).getString("id");
            }
            Inbox.update(context, id, new JSONObject().put("fileId", fileId));
        }
        progress.update("电脑正在处理 · " + label(tool));
        String request = "悬浮圈选 · " + label(tool);
        call(vault, "POST", "/api/sync", new JSONObject().put("id", syncId).put("entityId", noteId)
            .put("kind", "note.create").put("payload", new JSONObject()
                .put("courseId", courseId).put("title", request).put("overlayJobId", jobId)
                .put("content", "截图选区：[查看原图](/api/files/" + fileId + ")")));
        JSONObject payload = new JSONObject().put("courseId", courseId).put("imageFileId", fileId)
            .put("noteId", noteId).put("steps", steps(tool)).put("input", meta.optString("input", ""))
            .put("request", request);
        call(vault, "POST", "/api/jobs", new JSONObject().put("clientId", jobId).put("payload", payload));
        long deadline = System.currentTimeMillis() + 6L * 60 * 1000;
        while (System.currentTimeMillis() < deadline && !Thread.currentThread().isInterrupted()) {
            JSONObject job = call(vault, "GET", "/api/jobs/" + jobId, null);
            String status = job.optString("status");
            if ("done".equals(status) || "failed".equals(status) || "cancelled".equals(status) || "interrupted".equals(status)) {
                Inbox.acknowledge(context, id);
                return job;
            }
            progress.update("电脑处理 " + job.optInt("progress") + "% · " + label(tool));
            Thread.sleep(2000);
        }
        throw new IllegalStateException("电脑仍在处理；截图任务已保留，将继续查询。");
    }
    private static JSONObject processInput(Context context, Vault vault, String id, JSONObject meta, Progress progress) throws Exception {
        String courseId = meta.getString("courseId"), tool = meta.getString("tool"), jobId = meta.getString("jobId");
        String input = meta.optString("input", ""), documentId = meta.optString("documentId", "");
        progress.update("正在核对电脑身份…");
        if (!vault.serverId().equals(call(vault, "GET", "/api/connection", null).optString("serverId"))) throw new IllegalStateException("电脑身份已改变，请重新配对。内容仍保留在本机。");
        if ("overlay-document-job".equals(meta.optString("kind")) && documentId.isEmpty()) {
            byte[] document = bytes(Inbox.file(context, id), 20L * 1024 * 1024);
            progress.update("正在上传文档…");
            JSONObject upload = call(vault, "POST", "/api/uploads", new JSONObject()
                .put("clientId", id).put("kind", "document").put("courseId", courseId)
                .put("name", meta.getString("name")).put("mime", meta.optString("mime", "application/octet-stream"))
                .put("size", document.length).put("sha256", sha256(document)));
            JSONObject imported;
            if ("done".equals(upload.optString("status"))) imported = upload.getJSONObject("result");
            else {
                int chunkSize = upload.getInt("chunkSize"), count = (document.length + chunkSize - 1) / chunkSize;
                JSONArray prior = upload.getJSONArray("received");
                for (int i = 0; i < count; i++) {
                    if (!received(prior, i)) {
                        int offset = i * chunkSize, length = Math.min(chunkSize, document.length - offset);
                        call(vault, "PUT", "/api/uploads/" + id + "/chunks/" + i,
                            new JSONObject().put("data", Base64.encodeToString(document, offset, length, Base64.NO_WRAP)));
                    }
                    progress.update("文档上传 " + Math.round((i + 1) * 100f / count) + "%");
                }
                imported = call(vault, "POST", "/api/uploads/" + id + "/complete", new JSONObject());
            }
            documentId = imported.getString("id");
            Inbox.update(context, id, new JSONObject().put("documentId", documentId));
        }
        JSONObject payload = new JSONObject().put("courseId", courseId).put("steps", inputSteps(tool))
            .put("request", "悬浮输入 · " + label(tool)).put("input", input);
        if (!documentId.isEmpty()) {
            JSONObject imported = call(vault, "GET", "/api/documents/" + documentId + "/overlay-text", null);
            if (!courseId.equals(imported.optString("courseId"))) throw new IllegalStateException("文档不属于当前课程。");
            StringBuilder content = new StringBuilder(input).append("\n\n").append(imported.optString("text"));
            if (content.toString().trim().isEmpty()) throw new IllegalStateException("文档没有可提取文字，请使用截图圈选图片内容。");
            payload.put("input", content.substring(0, Math.min(content.length(), 55000)));
            payload.put("source", new JSONObject().put("documentId", documentId).put("page", 1));
        }
        progress.update("电脑正在处理 · " + label(tool));
        call(vault, "POST", "/api/jobs", new JSONObject().put("clientId", jobId).put("payload", payload));
        long deadline = System.currentTimeMillis() + 6L * 60 * 1000;
        while (System.currentTimeMillis() < deadline && !Thread.currentThread().isInterrupted()) {
            JSONObject job = call(vault, "GET", "/api/jobs/" + jobId, null);
            String status = job.optString("status");
            if ("done".equals(status) || "failed".equals(status) || "cancelled".equals(status) || "interrupted".equals(status)) {
                Inbox.acknowledge(context, id); return job;
            }
            progress.update("电脑处理 " + job.optInt("progress") + "% · " + label(tool));
            Thread.sleep(2000);
        }
        throw new IllegalStateException("电脑仍在处理；内容已保留，将继续查询。");
    }
}
