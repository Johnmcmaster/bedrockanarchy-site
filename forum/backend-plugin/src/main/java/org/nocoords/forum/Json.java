package org.nocoords.forum;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/*
 * Minimal JSON codec so the jar has zero dependencies. Parses into
 * Map<String,Object> / List<Object> / String / Long / Double / Boolean / null,
 * and writes the same shapes back out. Strict enough for an API that only ever
 * exchanges small, well-formed documents; anything malformed throws.
 */
public final class Json {

  private Json() {}

  public static Object parse(String text) {
    Parser parser = new Parser(text);
    Object value = parser.parseValue();
    parser.skipWhitespace();
    if (!parser.atEnd()) {
      throw new IllegalArgumentException("Trailing data after JSON value");
    }
    return value;
  }

  public static String write(Object value) {
    StringBuilder out = new StringBuilder();
    writeValue(out, value);
    return out.toString();
  }

  private static void writeValue(StringBuilder out, Object value) {
    if (value == null) {
      out.append("null");
    } else if (value instanceof String s) {
      writeString(out, s);
    } else if (value instanceof Boolean || value instanceof Long || value instanceof Integer) {
      out.append(value);
    } else if (value instanceof Double d) {
      if (d.isNaN() || d.isInfinite()) {
        throw new IllegalArgumentException("Cannot encode non-finite number");
      }
      out.append(d.doubleValue());
    } else if (value instanceof Map<?, ?> map) {
      out.append('{');
      boolean first = true;
      for (Map.Entry<?, ?> entry : map.entrySet()) {
        if (!first) {
          out.append(',');
        }
        first = false;
        writeString(out, String.valueOf(entry.getKey()));
        out.append(':');
        writeValue(out, entry.getValue());
      }
      out.append('}');
    } else if (value instanceof List<?> list) {
      out.append('[');
      boolean first = true;
      for (Object item : list) {
        if (!first) {
          out.append(',');
        }
        first = false;
        writeValue(out, item);
      }
      out.append(']');
    } else {
      throw new IllegalArgumentException("Cannot encode " + value.getClass());
    }
  }

  private static void writeString(StringBuilder out, String s) {
    out.append('"');
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      switch (c) {
        case '"' -> out.append("\\\"");
        case '\\' -> out.append("\\\\");
        case '\b' -> out.append("\\b");
        case '\f' -> out.append("\\f");
        case '\n' -> out.append("\\n");
        case '\r' -> out.append("\\r");
        case '\t' -> out.append("\\t");
        default -> {
          if (c < 0x20) {
            out.append(String.format("\\u%04x", (int) c));
          } else {
            out.append(c);
          }
        }
      }
    }
    out.append('"');
  }

  private static final class Parser {
    private final String text;
    private int pos;

    Parser(String text) {
      this.text = text;
    }

    boolean atEnd() {
      return pos >= text.length();
    }

    void skipWhitespace() {
      while (pos < text.length()) {
        char c = text.charAt(pos);
        if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
          pos++;
        } else {
          break;
        }
      }
    }

    Object parseValue() {
      skipWhitespace();
      if (atEnd()) {
        throw new IllegalArgumentException("Unexpected end of JSON");
      }
      char c = text.charAt(pos);
      return switch (c) {
        case '{' -> parseObject();
        case '[' -> parseArray();
        case '"' -> parseString();
        case 't' -> parseLiteral("true", Boolean.TRUE);
        case 'f' -> parseLiteral("false", Boolean.FALSE);
        case 'n' -> parseLiteral("null", null);
        default -> parseNumber();
      };
    }

    private Object parseLiteral(String literal, Object value) {
      if (!text.startsWith(literal, pos)) {
        throw new IllegalArgumentException("Invalid JSON literal at " + pos);
      }
      pos += literal.length();
      return value;
    }

    private Map<String, Object> parseObject() {
      expect('{');
      Map<String, Object> map = new LinkedHashMap<>();
      skipWhitespace();
      if (peek() == '}') {
        pos++;
        return map;
      }
      for (;;) {
        skipWhitespace();
        String key = parseString();
        skipWhitespace();
        expect(':');
        map.put(key, parseValue());
        skipWhitespace();
        char c = next();
        if (c == '}') {
          return map;
        }
        if (c != ',') {
          throw new IllegalArgumentException("Expected ',' or '}' at " + (pos - 1));
        }
      }
    }

    private List<Object> parseArray() {
      expect('[');
      List<Object> list = new ArrayList<>();
      skipWhitespace();
      if (peek() == ']') {
        pos++;
        return list;
      }
      for (;;) {
        list.add(parseValue());
        skipWhitespace();
        char c = next();
        if (c == ']') {
          return list;
        }
        if (c != ',') {
          throw new IllegalArgumentException("Expected ',' or ']' at " + (pos - 1));
        }
      }
    }

    private String parseString() {
      expect('"');
      StringBuilder out = new StringBuilder();
      for (;;) {
        char c = next();
        if (c == '"') {
          return out.toString();
        }
        if (c == '\\') {
          char escape = next();
          switch (escape) {
            case '"' -> out.append('"');
            case '\\' -> out.append('\\');
            case '/' -> out.append('/');
            case 'b' -> out.append('\b');
            case 'f' -> out.append('\f');
            case 'n' -> out.append('\n');
            case 'r' -> out.append('\r');
            case 't' -> out.append('\t');
            case 'u' -> {
              if (pos + 4 > text.length()) {
                throw new IllegalArgumentException("Bad unicode escape");
              }
              out.append((char) Integer.parseInt(text.substring(pos, pos + 4), 16));
              pos += 4;
            }
            default -> throw new IllegalArgumentException("Bad escape \\" + escape);
          }
        } else if (c < 0x20) {
          throw new IllegalArgumentException("Unescaped control character in string");
        } else {
          out.append(c);
        }
      }
    }

    private Object parseNumber() {
      int start = pos;
      if (peek() == '-') {
        pos++;
      }
      while (!atEnd() && Character.isDigit(text.charAt(pos))) {
        pos++;
      }
      boolean isDouble = false;
      if (!atEnd() && text.charAt(pos) == '.') {
        isDouble = true;
        pos++;
        while (!atEnd() && Character.isDigit(text.charAt(pos))) {
          pos++;
        }
      }
      if (!atEnd() && (text.charAt(pos) == 'e' || text.charAt(pos) == 'E')) {
        isDouble = true;
        pos++;
        if (!atEnd() && (text.charAt(pos) == '+' || text.charAt(pos) == '-')) {
          pos++;
        }
        while (!atEnd() && Character.isDigit(text.charAt(pos))) {
          pos++;
        }
      }
      String raw = text.substring(start, pos);
      if (raw.isEmpty() || raw.equals("-")) {
        throw new IllegalArgumentException("Invalid number at " + start);
      }
      if (isDouble) {
        return Double.parseDouble(raw);
      }
      try {
        return Long.parseLong(raw);
      } catch (NumberFormatException e) {
        return Double.parseDouble(raw);
      }
    }

    private char peek() {
      if (atEnd()) {
        throw new IllegalArgumentException("Unexpected end of JSON");
      }
      return text.charAt(pos);
    }

    private char next() {
      char c = peek();
      pos++;
      return c;
    }

    private void expect(char expected) {
      char c = next();
      if (c != expected) {
        throw new IllegalArgumentException("Expected '" + expected + "' at " + (pos - 1));
      }
    }
  }
}
