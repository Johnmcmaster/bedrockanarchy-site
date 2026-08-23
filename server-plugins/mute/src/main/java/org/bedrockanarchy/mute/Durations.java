package org.bedrockanarchy.mute;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Parses and formats human durations such as {@code 30m}, {@code 2h}, {@code 7d}, {@code 1w}. */
public final class Durations {

    private static final Pattern TOKEN = Pattern.compile("(?i)(\\d+)\\s*([smhdw])");

    private Durations() {}

    /**
     * Parses a duration string into milliseconds.
     *
     * @return the duration in millis, {@code 0} for a permanent mute
     *         (input {@code null}, empty, "perm", "permanent", "forever"),
     *         or {@code -1} if the input could not be parsed.
     */
    public static long parse(String input) {
        if (input == null) return 0L;
        String s = input.trim().toLowerCase();
        if (s.isEmpty() || s.equals("perm") || s.equals("permanent") || s.equals("forever")) {
            return 0L;
        }
        Matcher m = TOKEN.matcher(s);
        long total = 0L;
        int matchedTo = 0;
        boolean any = false;
        while (m.find()) {
            if (m.start() != matchedTo) return -1L; // gap => junk between tokens
            any = true;
            long value = Long.parseLong(m.group(1));
            switch (m.group(2).charAt(0)) {
                case 's': total += value * 1000L; break;
                case 'm': total += value * 60_000L; break;
                case 'h': total += value * 3_600_000L; break;
                case 'd': total += value * 86_400_000L; break;
                case 'w': total += value * 604_800_000L; break;
                default: return -1L;
            }
            matchedTo = m.end();
        }
        if (!any || matchedTo != s.length()) return -1L;
        return total;
    }

    /** Formats a remaining-millis value as a short human string, e.g. {@code 1d 3h 20m}. */
    public static String format(long millis) {
        if (millis <= 0L) return "0s";
        long seconds = millis / 1000L;
        long days = seconds / 86_400L; seconds %= 86_400L;
        long hours = seconds / 3_600L; seconds %= 3_600L;
        long mins = seconds / 60L;    seconds %= 60L;

        StringBuilder sb = new StringBuilder();
        if (days > 0)  sb.append(days).append("d ");
        if (hours > 0) sb.append(hours).append("h ");
        if (mins > 0)  sb.append(mins).append("m ");
        if (seconds > 0 && days == 0 && hours == 0) sb.append(seconds).append("s ");
        String out = sb.toString().trim();
        return out.isEmpty() ? "0s" : out;
    }
}
