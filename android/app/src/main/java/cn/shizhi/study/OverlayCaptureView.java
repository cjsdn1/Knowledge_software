package cn.shizhi.study;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.ByteArrayOutputStream;

/** The full-resolution screenshot stays local until the user sends a selected region. */
final class OverlayCaptureView extends LinearLayout {
    static final class EncodedImage {
        final byte[] data; final String mime;
        EncodedImage(byte[] data, String mime) { this.data = data; this.mime = mime; }
    }
    interface Listener { void send(EncodedImage image, String tool); void discard(); }
    static final String[][] TOOLS = {
        {"capture", "解释"}, {"translate", "翻译"}, {"explain", "知识解释"},
        {"summarize", "重点"}, {"cards", "卡片"}, {"formula", "公式"},
        {"code", "代码"}, {"dictionary", "词典"}, {"calculator", "计算"}, {"note", "记笔记"}
    };
    private final CropArea crop;
    private final LinearLayout toolList;
    private final ScrollView toolScroll;
    private final TextView chosenTool;
    private String selected;

    private int dp(int v) { return (int) (v * getResources().getDisplayMetrics().density + .5f); }
    private GradientDrawable background(int color, int radius) {
        GradientDrawable shape = new GradientDrawable(); shape.setColor(color); shape.setCornerRadius(dp(radius)); return shape;
    }
    private TextView button(String label, int color) {
        TextView view = new TextView(getContext()); view.setText(label); view.setTextColor(Color.WHITE);
        view.setTextSize(14); view.setGravity(Gravity.CENTER); view.setPadding(dp(12), dp(9), dp(12), dp(9));
        view.setBackground(background(color, 11)); return view;
    }
    OverlayCaptureView(Context context, Bitmap bitmap, String tool, Listener listener) {
        super(context); setOrientation(VERTICAL); setPadding(dp(12), dp(12), dp(12), dp(12));
        setBackground(background(0xfff7faf8, 18)); setElevation(dp(12));
        selected = validTool(tool) && !"capture".equals(tool) ? tool : "explain";
        LinearLayout header = new LinearLayout(context); header.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = new TextView(context); title.setText("圈选截图 · 留在当前应用"); title.setTextColor(0xff173b2d); title.setTextSize(16);
        header.addView(title, new LayoutParams(0, dp(38), 1));
        TextView close = button("丢弃", 0xff75877d); header.addView(close); close.setOnClickListener(v -> listener.discard());
        addView(header);
        crop = new CropArea(context, bitmap);
        addView(crop, new LayoutParams(LayoutParams.MATCH_PARENT,
            Math.min(dp(320), (int) (getResources().getDisplayMetrics().heightPixels * .38f))));
        TextView hint = new TextView(context); hint.setText("拖动框选；不框选则处理整张。优先保留清晰原图，只上传提交的选区。");
        hint.setTextSize(12); hint.setTextColor(0xff52695e); hint.setPadding(0, dp(8), 0, dp(8)); addView(hint);
        LinearLayout picker = new LinearLayout(context); picker.setOrientation(VERTICAL); picker.setPadding(dp(12), dp(7), dp(12), dp(7));
        picker.setBackground(background(0xffedf2ed, 12));
        TextView label = new TextView(context); label.setText("使用工具"); label.setTextSize(11); label.setTextColor(0xff536b5a); picker.addView(label);
        chosenTool = new TextView(context); chosenTool.setTextSize(15); chosenTool.setTextColor(0xff213f34); chosenTool.setPadding(0, dp(5), 0, dp(5)); picker.addView(chosenTool);
        toolList = new LinearLayout(context); toolList.setOrientation(VERTICAL);
        toolScroll = new ScrollView(context); toolScroll.addView(toolList); toolScroll.setVisibility(GONE);
        picker.addView(toolScroll, new LayoutParams(LayoutParams.MATCH_PARENT, dp(150)));
        chosenTool.setOnClickListener(v -> toolScroll.setVisibility(toolScroll.getVisibility() == VISIBLE ? GONE : VISIBLE));
        addView(picker);
        drawTools();
        TextView send = button("处理选区", 0xff376454);
        LayoutParams sendParams = new LayoutParams(LayoutParams.MATCH_PARENT, dp(48)); sendParams.topMargin = dp(9);
        addView(send, sendParams);
        send.setOnClickListener(v -> {
            send.setEnabled(false); send.setText("正在打包…");
            try { listener.send(crop.encoded(), selected); }
            catch (Exception error) { send.setEnabled(true); send.setText("重试打包选区"); android.widget.Toast.makeText(getContext(), error.getMessage(), android.widget.Toast.LENGTH_SHORT).show(); }
        });
    }
    private boolean validTool(String id) { for (String[] item : TOOLS) if (item[0].equals(id)) return true; return false; }
    private void drawTools() {
        toolList.removeAllViews();
        for (String[] item : TOOLS) {
            if ("capture".equals(item[0])) continue;
            TextView option = new TextView(getContext()); option.setText(item[1]); option.setTextSize(14); option.setTextColor(0xff284638);
            option.setPadding(dp(10), dp(10), dp(10), dp(10)); option.setBackground(background(0xffffffff, 9));
            LayoutParams p = new LayoutParams(LayoutParams.MATCH_PARENT, dp(42)); p.topMargin = dp(4); toolList.addView(option, p);
            option.setOnClickListener(v -> { selected = item[0]; chosenTool.setText(item[1] + "  ⌄"); toolScroll.setVisibility(GONE); });
            if (selected.equals(item[0])) chosenTool.setText(item[1] + "  ⌄");
        }
    }
    private static final class CropArea extends View {
        private final Bitmap image;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        private final RectF imageRect = new RectF(), selection = new RectF();
        private float startX, startY; private boolean selected;
        CropArea(Context context, Bitmap bitmap) { super(context); image = bitmap; setBackgroundColor(0xffdce6df); }
        private void layoutImage() {
            float scale = Math.min(getWidth() / (float) image.getWidth(), getHeight() / (float) image.getHeight());
            float w = image.getWidth() * scale, h = image.getHeight() * scale;
            imageRect.set((getWidth() - w) / 2, (getHeight() - h) / 2, (getWidth() + w) / 2, (getHeight() + h) / 2);
        }
        @Override protected void onDraw(Canvas canvas) {
            super.onDraw(canvas); layoutImage();
            canvas.drawBitmap(image, null, imageRect, paint);
            if (selected) {
                paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(5); paint.setColor(0xfff3bf4a);
                canvas.drawRect(selection, paint); paint.setStyle(Paint.Style.FILL); paint.setColor(Color.WHITE);
            }
        }
        private float clamp(float value, float min, float max) { return Math.max(min, Math.min(max, value)); }
        @Override public boolean onTouchEvent(MotionEvent event) {
            float x = clamp(event.getX(), imageRect.left, imageRect.right), y = clamp(event.getY(), imageRect.top, imageRect.bottom);
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN: startX = x; startY = y; selection.set(x, y, x, y); selected = true; invalidate(); return true;
                case MotionEvent.ACTION_MOVE: selection.set(Math.min(startX, x), Math.min(startY, y), Math.max(startX, x), Math.max(startY, y)); invalidate(); return true;
                case MotionEvent.ACTION_UP: selection.set(Math.min(startX, x), Math.min(startY, y), Math.max(startX, x), Math.max(startY, y));
                    if (selection.width() < 8 || selection.height() < 8) selected = false; invalidate(); return true;
                case MotionEvent.ACTION_CANCEL: selected = false; invalidate(); return true;
            }
            return false;
        }
        EncodedImage encoded() {
            layoutImage();
            Rect box;
            if (!selected) box = new Rect(0, 0, image.getWidth(), image.getHeight());
            else {
                float ratioX = image.getWidth() / imageRect.width(), ratioY = image.getHeight() / imageRect.height();
                box = new Rect(
                    Math.max(0, (int) ((selection.left - imageRect.left) * ratioX)),
                    Math.max(0, (int) ((selection.top - imageRect.top) * ratioY)),
                    Math.min(image.getWidth(), (int) Math.ceil((selection.right - imageRect.left) * ratioX)),
                    Math.min(image.getHeight(), (int) Math.ceil((selection.bottom - imageRect.top) * ratioY)));
            }
            if (box.width() < 1 || box.height() < 1) throw new IllegalStateException("请重新圈选截图区域。");
            Bitmap cut = Bitmap.createBitmap(image, box.left, box.top, box.width(), box.height());
            Bitmap sized = cut;
            try {
                final int limit = 8 * 1024 * 1024;
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                cut.compress(Bitmap.CompressFormat.PNG, 100, out);
                if (out.size() <= limit) return new EncodedImage(out.toByteArray(), "image/png");
                float scale = Math.min(1f, 3200f / Math.max(cut.getWidth(), cut.getHeight()));
                if (scale < 1f) sized = Bitmap.createScaledBitmap(cut, Math.max(1, Math.round(cut.getWidth() * scale)), Math.max(1, Math.round(cut.getHeight() * scale)), true);
                for (int quality : new int[]{96, 92, 88, 84}) {
                    out.reset(); sized.compress(Bitmap.CompressFormat.JPEG, quality, out);
                    if (out.size() <= limit) return new EncodedImage(out.toByteArray(), "image/jpeg");
                }
                while (out.size() > limit && Math.max(sized.getWidth(), sized.getHeight()) > 800) {
                    Bitmap smaller = Bitmap.createScaledBitmap(sized, Math.max(1, Math.round(sized.getWidth() * .8f)), Math.max(1, Math.round(sized.getHeight() * .8f)), true);
                    if (sized != cut) sized.recycle();
                    sized = smaller; out.reset(); sized.compress(Bitmap.CompressFormat.JPEG, 88, out);
                }
                if (out.size() > limit) throw new IllegalStateException("选区过大，请缩小圈选范围。");
                return new EncodedImage(out.toByteArray(), "image/jpeg");
            } finally {
                if (sized != cut) sized.recycle();
                if (cut != image) cut.recycle();
            }
        }
    }
}
