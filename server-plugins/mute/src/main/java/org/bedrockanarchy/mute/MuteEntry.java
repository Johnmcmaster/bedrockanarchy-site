package org.bedrockanarchy.mute;

/**
 * An active mute record. {@code until == 0} means a permanent mute.
 */
public final class MuteEntry {

    private final String name;
    private final long until;      // epoch millis; 0 = permanent
    private final String reason;
    private final String source;   // who issued the mute
    private final long created;

    public MuteEntry(String name, long until, String reason, String source, long created) {
        this.name = name;
        this.until = until;
        this.reason = reason;
        this.source = source;
        this.created = created;
    }

    public String name()   { return name; }
    public long until()    { return until; }
    public String reason() { return reason; }
    public String source() { return source; }
    public long created()  { return created; }

    public boolean permanent() {
        return until == 0L;
    }

    public boolean expired(long now) {
        return until != 0L && now >= until;
    }

    public long remainingMillis(long now) {
        return until == 0L ? Long.MAX_VALUE : Math.max(0L, until - now);
    }
}
