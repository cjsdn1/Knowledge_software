package cn.shizhi.study;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Compact, focusable tool card displayed over the current app. */
final class OverlayToolPanel extends LinearLayout {
    interface Listener {
        void process(String tool, String input, String attachmentId);
        void capture(String tool);
        void pickFile();
        void pickImage();
        void lookupWord(String word);
        void removeAttachment(String id);
        void close();
    }
    static final String[][] TOOLS = {
        {"explain", "解释"}, {"translate", "翻译"}, {"summarize", "整理重点"}, {"cards", "复习卡片"},
        {"formula", "公式识别与解释"}, {"code", "代码解释"}, {"dictionary", "词典"},
        {"calculator", "计算器"}, {"note", "保存笔记"}
    };
    private final Listener listener;
    private final int surface, soft, ink, muted, accent, line;
    private final LinearLayout toolOptions, workspace, body;
    private final ScrollView optionScroll;
    private ScrollView contentScroll;
    private final TextView chosen, output, attachment, process;
    private final EditText input;
    private TextView translationSource, wordOutput;
    private EditText calculator;
    private android.widget.ImageView imagePreview;
    private String tool = "explain", attachmentId = "", attachmentName = "";
    private String calculatorValue = "";
    private boolean cardBack;

    private int dp(int value) { return (int) (value * getResources().getDisplayMetrics().density + .5f); }
    private GradientDrawable shape(int color, int radius) {
        GradientDrawable result = new GradientDrawable(); result.setColor(color); result.setCornerRadius(dp(radius));
        result.setStroke(dp(1), line); return result;
    }
    private TextView label(String value, int size, int color) {
        TextView view = new TextView(getContext()); view.setText(value); view.setTextSize(size); view.setTextColor(color);
        view.setGravity(Gravity.CENTER_VERTICAL); return view;
    }
    private TextView button(String value, boolean strong) {
        TextView view = label(value, 13, strong ? surface : ink); view.setGravity(Gravity.CENTER);
        view.setPadding(dp(9), dp(8), dp(9), dp(8)); view.setBackground(shape(strong ? accent : soft, 11));
        return view;
    }
    private void addSpace(LinearLayout target, int size) { View spacer = new View(getContext()); target.addView(spacer, new LayoutParams(1, dp(size))); }
    private void addCaption(String title, String detail) {
        TextView name = label(title, 14, ink); name.setTypeface(null, 1); workspace.addView(name);
        addSpace(workspace, 8);
    }
    private void card(String text) {
        TextView card = label(text, 13, ink); card.setPadding(dp(12), dp(11), dp(12), dp(11));
        card.setBackground(shape(surface, 11)); workspace.addView(card, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        addSpace(workspace, 7);
    }
    OverlayToolPanel(Context context, Listener listener, String initialTool) {
        super(context); this.listener = listener;
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        surface = dark ? 0xff24342b : 0xfffbfdfb; soft = dark ? 0xff304338 : 0xffeff5ef;
        ink = dark ? 0xffeff5ee : 0xff20372c; muted = dark ? 0xffafc2b2 : 0xff718579;
        accent = dark ? 0xff8fbea0 : 0xff386554; line = dark ? 0xff506959 : 0xffdce7dd;
        setOrientation(VERTICAL); setPadding(dp(14), dp(12), dp(14), dp(12)); setBackground(shape(surface, 19)); setElevation(dp(13));
        if (valid(initialTool)) tool = initialTool;
        LinearLayout header = new LinearLayout(context); header.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = label("✦  拾知 · 随手处理", 16, ink); title.setTypeface(null, 1);
        header.addView(title, new LayoutParams(0, dp(39), 1));
        TextView close = button("收起", false); close.setOnClickListener(v -> listener.close()); header.addView(close);
        addView(header); addSpace(this, 7);
        ScrollView scroll = new ScrollView(context); contentScroll = scroll; scroll.setFillViewport(false); scroll.setVerticalScrollBarEnabled(true);
        body = new LinearLayout(context); body.setOrientation(VERTICAL); scroll.addView(body);
        addView(scroll, new LayoutParams(LayoutParams.MATCH_PARENT, 0, 1));
        LinearLayout picker = new LinearLayout(context); picker.setOrientation(VERTICAL); picker.setPadding(dp(11), dp(8), dp(11), dp(8)); picker.setBackground(shape(soft, 12));
        picker.addView(label("使用工具", 11, muted));
        chosen = label("", 15, ink); chosen.setPadding(0, dp(5), 0, dp(5)); picker.addView(chosen);
        toolOptions = new LinearLayout(context); toolOptions.setOrientation(VERTICAL);
        optionScroll = new ScrollView(context); optionScroll.addView(toolOptions); optionScroll.setVisibility(GONE);
        optionScroll.setOnTouchListener((v, event) -> {
            v.getParent().requestDisallowInterceptTouchEvent(event.getActionMasked() != android.view.MotionEvent.ACTION_UP && event.getActionMasked() != android.view.MotionEvent.ACTION_CANCEL);
            return false;
        });
        picker.addView(optionScroll, new LayoutParams(LayoutParams.MATCH_PARENT, dp(190)));
        chosen.setOnClickListener(v -> optionScroll.setVisibility(optionScroll.getVisibility() == VISIBLE ? GONE : VISIBLE));
        body.addView(picker); addSpace(body, 11);
        workspace = new LinearLayout(context); workspace.setOrientation(VERTICAL); workspace.setPadding(dp(11), dp(10), dp(11), dp(7)); workspace.setBackground(shape(soft, 13));
        body.addView(workspace); addSpace(body, 12);
        TextView inputLabel = label("输入内容", 12, ink); body.addView(inputLabel); addSpace(body, 5);
        input = new EditText(context); input.setTextSize(14); input.setTextColor(ink); input.setHintTextColor(muted);
        input.setHint("输入、粘贴，或添加图片与文档"); input.setGravity(Gravity.TOP); input.setMinLines(3); input.setMaxLines(6);
        input.setPadding(dp(11), dp(10), dp(11), dp(10)); input.setBackground(shape(surface, 12));
        input.setCustomSelectionActionModeCallback(new android.view.ActionMode.Callback() {
            public boolean onCreateActionMode(android.view.ActionMode mode, android.view.Menu menu) { menu.add(0, 7201, 0, "查词"); return true; }
            public boolean onPrepareActionMode(android.view.ActionMode mode, android.view.Menu menu) { return false; }
            public boolean onActionItemClicked(android.view.ActionMode mode, android.view.MenuItem item) {
                if (item.getItemId() != 7201) return false;
                int a = input.getSelectionStart(), b = input.getSelectionEnd();
                if (a >= 0 && b > a) listener.lookupWord(input.getText().subSequence(a,b).toString()); mode.finish(); return true;
            }
            public void onDestroyActionMode(android.view.ActionMode mode) { }
        });
        input.addTextChangedListener(new android.text.TextWatcher() {
            public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            public void onTextChanged(CharSequence s, int start, int before, int count) { if (translationSource != null) wordLinks(translationSource, s.toString()); }
            public void afterTextChanged(android.text.Editable s) { }
        });
        body.addView(input, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT)); addSpace(body, 9);
        LinearLayout actions = new LinearLayout(context);
        TextView gallery = button("图库", false); gallery.setOnClickListener(v -> listener.pickImage());
        LayoutParams third = new LayoutParams(0, dp(44), 1); third.rightMargin = dp(6); actions.addView(gallery, third);
        TextView file = button("添加文档", false); file.setOnClickListener(v -> listener.pickFile());
        TextView capture = button("▣ 截屏", false); capture.setOnClickListener(v -> listener.capture(tool));
        LayoutParams half = new LayoutParams(0, dp(43), 1); half.rightMargin = dp(7); actions.addView(file, half);
        actions.addView(capture, new LayoutParams(0, dp(43), 1)); body.addView(actions);
        imagePreview = new android.widget.ImageView(context); imagePreview.setAdjustViewBounds(true); imagePreview.setMaxHeight(dp(230)); imagePreview.setVisibility(GONE); body.addView(imagePreview, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        attachment = label("", 11, muted); attachment.setVisibility(GONE); attachment.setPadding(dp(5), dp(7), dp(5), dp(3)); body.addView(attachment);
        attachment.setOnClickListener(v -> { if (!attachmentId.isEmpty()) { listener.removeAttachment(attachmentId); setAttachment("", ""); } });
        output = label("", 13, ink); output.setTextIsSelectable(true); output.setPadding(dp(11), dp(10), dp(11), dp(10));
        output.setBackground(shape(soft, 12)); output.setVisibility(GONE);
        LayoutParams outputParams = new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT); outputParams.topMargin = dp(11); body.addView(output, outputParams);
        wordOutput = label("", 14, ink); wordOutput.setTextIsSelectable(true); wordOutput.setPadding(dp(12), dp(12), dp(12), dp(12)); wordOutput.setBackground(shape(soft, 12)); wordOutput.setVisibility(GONE); body.addView(wordOutput);
        addSpace(this, 9);
        process = button("开始处理", true); process.setOnClickListener(v -> {
            String value = "calculator".equals(tool) && calculator != null ? calculator.getText().toString().trim() : input.getText().toString().trim();
            listener.process(tool, value, attachmentId);
        });
        addView(process, new LayoutParams(LayoutParams.MATCH_PARENT, dp(46)));
        renderTools(); renderWorkspace();
    }
    private boolean valid(String id) { for (String[] entry : TOOLS) if (entry[0].equals(id)) return true; return false; }
    private String toolName() { for (String[] entry : TOOLS) if (entry[0].equals(tool)) return entry[1]; return "解释"; }
    private void renderTools() {
        toolOptions.removeAllViews(); chosen.setText(toolName() + "  ⌄");
        for (String[] entry : TOOLS) {
            TextView option = button(entry[1] + (tool.equals(entry[0]) ? "   ✓" : ""), false);
            LayoutParams params = new LayoutParams(LayoutParams.MATCH_PARENT, dp(42)); params.topMargin = dp(4); toolOptions.addView(option, params);
            option.setOnClickListener(v -> { tool = entry[0]; optionScroll.setVisibility(GONE); clearOutput(); renderTools(); renderWorkspace(); contentScroll.post(() -> contentScroll.smoothScrollTo(0, 0)); });
        }
    }
    private void renderWorkspace() {
        workspace.removeAllViews(); calculator = null; translationSource = null;
        switch (tool) {
            case "explain": addCaption("理解方式", "原文 → 核心意思 → 举例"); card("简明解释   ·   逐步拆解   ·   生活化例子"); break;
            case "translate":
                addCaption("双语对照", "");
                translationSource = label("", 15, ink); translationSource.setPadding(dp(8),dp(10),dp(8),dp(10));
                workspace.addView(translationSource); wordLinks(translationSource, input.getText().toString());
                break;
            case "summarize": addCaption("整理重点", "提炼三条关键信息"); card("01  关键结论\n02  原因与依据\n03  值得记住的例子"); break;
            case "cards":
                addCaption("复习卡片", "点卡片翻面");
                TextView flash = button(cardBack ? "背面 · 导数表示瞬时变化率\n轻点返回问题" : "正面 · 导数描述了什么？\n轻点查看答案", false);
                flash.setMinHeight(dp(90)); flash.setOnClickListener(v -> { cardBack = !cardBack; renderWorkspace(); }); workspace.addView(flash); break;
            case "formula": addCaption("公式识别与解释", "符号含义 · 推导思路"); card("f′(x) = lim h→0 [f(x+h) − f(x)] / h"); break;
            case "code": addCaption("代码解释", "逐行读懂输入与输出"); card("01  function double(x) {\n02    return x * 2;\n03  }"); break;
            case "dictionary": addCaption("词典", "词性 · 释义 · 例句"); card("connect /kəˈnekt/\nv. 连接；建立联系\nIdeas connect across subjects."); break;
            case "calculator":
                addCaption("计算器", "输入算式或按下方数字键");
                calculator = new EditText(getContext()); calculator.setSingleLine(true); calculator.setTextSize(25); calculator.setTextColor(ink);
                calculator.setGravity(Gravity.RIGHT); calculator.setHint("0"); calculator.setText(calculatorValue);
                calculator.setBackground(shape(surface, 10)); calculator.setPadding(dp(9), dp(7), dp(9), dp(7));
                workspace.addView(calculator, new LayoutParams(LayoutParams.MATCH_PARENT, dp(52))); addSpace(workspace, 7);
                String[] keys = {"C", "(", ")", "⌫", "7", "8", "9", "÷", "4", "5", "6", "×", "1", "2", "3", "−", "0", ".", "=", "+"};
                for (int row = 0; row < 5; row++) {
                    LinearLayout keysRow = new LinearLayout(getContext());
                    for (int col = 0; col < 4; col++) {
                        String key = keys[row * 4 + col]; TextView keyView = button(key, "=".equals(key));
                        LayoutParams params = new LayoutParams(0, dp(40), 1); params.rightMargin = dp(4); params.bottomMargin = dp(4); keysRow.addView(keyView, params);
                        keyView.setOnClickListener(v -> {
                            String current = calculator.getText().toString();
                            if ("C".equals(key)) current = "";
                            else if ("⌫".equals(key)) current = current.isEmpty() ? "" : current.substring(0, current.length() - 1);
                            else if ("=".equals(key)) { try { current = SimpleCalculator.evaluate(current); } catch (Exception error) { showOutput("算式错误", error.getMessage()); } }
                            else current += key;
                            calculator.setText(current); calculator.setSelection(current.length()); calculatorValue = current;
                        });
                    }
                    workspace.addView(keysRow);
                }
                break;
            case "note": addCaption("保存笔记", "处理后归入当前课程"); card("当前课程  ›  新笔记"); break;
        }
        process.setText("note".equals(tool) ? "保存到课程" : "calculator".equals(tool) ? "保存计算结果" : "开始" + toolName());
    }
    String currentTool() { return tool; }
    String currentInput() { return input.getText().toString().trim(); }
    void setInput(String value) { input.setText(value == null ? "" : value); }
    void setImageFile(java.io.File file) {
        android.graphics.BitmapFactory.Options options = new android.graphics.BitmapFactory.Options(); options.inJustDecodeBounds = true;
        android.graphics.BitmapFactory.decodeFile(file.getAbsolutePath(), options);
        options.inSampleSize = 1; while (options.outWidth / options.inSampleSize > 1200 || options.outHeight / options.inSampleSize > 1600) options.inSampleSize *= 2;
        options.inJustDecodeBounds = false; imagePreview.setImageBitmap(android.graphics.BitmapFactory.decodeFile(file.getAbsolutePath(), options)); imagePreview.setVisibility(VISIBLE);
    }
    void setAttachment(String id, String name) {
        imagePreview.setImageDrawable(null); imagePreview.setVisibility(GONE);
        attachmentId = id == null ? "" : id; attachmentName = name == null ? "" : name;
        attachment.setText(attachmentId.isEmpty() ? "" : "已添加 · " + attachmentName + "   × 移除");
        attachment.setVisibility(attachmentId.isEmpty() ? GONE : VISIBLE);
    }
    void showOutput(String title, String detail) {
        if ("translate".equals(tool)) wordLinks(output, title + "\n\n" + detail); else output.setText(title + "\n\n" + detail); output.setVisibility(VISIBLE);
        contentScroll.post(() -> contentScroll.smoothScrollTo(0, output.getTop()));
    }
    private void wordLinks(TextView target, String text) {
        if (text.trim().isEmpty()) { target.setText("输入原文后，轻点英文单词查词"); return; }
        android.text.SpannableString linked = new android.text.SpannableString(text);
        java.util.regex.Matcher matcher = java.util.regex.Pattern.compile("[A-Za-z]+(?:['’–-][A-Za-z]+)*").matcher(text);
        while (matcher.find()) {
            final String word = matcher.group();
            linked.setSpan(new android.text.style.ClickableSpan() {
                public void onClick(View view) { listener.lookupWord(word); }
                public void updateDrawState(android.text.TextPaint paint) { paint.setColor(accent); paint.setUnderlineText(true); }
            }, matcher.start(), matcher.end(), android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        target.setText(linked); target.setMovementMethod(android.text.method.LinkMovementMethod.getInstance());
    }
    void showWordOutput(String title, String detail) {
        wordOutput.setText(title + "\n\n" + detail); wordOutput.setVisibility(VISIBLE);
        contentScroll.post(() -> contentScroll.smoothScrollTo(0, wordOutput.getTop()));
    }
    void setBusy(boolean busy) { process.setEnabled(!busy); process.setAlpha(busy ? .55f : 1f); }
    void clearOutput() { output.setVisibility(GONE); output.setText(""); }
}
