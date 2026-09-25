package cn.shizhi.study;

import java.math.BigDecimal;
import java.math.MathContext;

/** Arithmetic only; never evaluates code or JavaScript. */
final class SimpleCalculator {
    private final String input;
    private int index;
    private SimpleCalculator(String value) { input = value.replace("×", "*").replace("÷", "/").replace("−", "-").replaceAll("\\s+", ""); }
    static String evaluate(String value) {
        SimpleCalculator parser = new SimpleCalculator(value);
        if (parser.input.isEmpty()) throw new IllegalArgumentException("请输入算式。");
        double result = parser.sum();
        if (parser.index != parser.input.length()) throw new IllegalArgumentException("算式不完整。");
        if (!Double.isFinite(result)) throw new IllegalArgumentException("除数不能为零。");
        return new BigDecimal(result, new MathContext(12)).stripTrailingZeros().toPlainString();
    }
    private char current() { return index < input.length() ? input.charAt(index) : '\0'; }
    private double number() {
        if (current() == '+') { index++; return number(); }
        if (current() == '-') { index++; return -number(); }
        if (current() == '(') {
            index++; double result = sum();
            if (current() != ')') throw new IllegalArgumentException("括号未配对。");
            index++; return result;
        }
        int start = index; boolean dot = false;
        while (Character.isDigit(current()) || current() == '.') {
            if (current() == '.') { if (dot) throw new IllegalArgumentException("数字格式错误。"); dot = true; }
            index++;
        }
        if (start == index) throw new IllegalArgumentException("算式不完整。");
        try { return Double.parseDouble(input.substring(start, index)); }
        catch (NumberFormatException error) { throw new IllegalArgumentException("数字格式错误。"); }
    }
    private double product() {
        double result = number();
        while (current() == '*' || current() == '/') {
            char op = input.charAt(index++); double right = number();
            result = op == '*' ? result * right : result / right;
        }
        return result;
    }
    private double sum() {
        double result = product();
        while (current() == '+' || current() == '-') {
            char op = input.charAt(index++); double right = product();
            result = op == '+' ? result + right : result - right;
        }
        return result;
    }
}
