package org.bedrockanarchy.mute;

import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Thread-safe store of mutes keyed by player UUID, persisted to {@code mutes.yml}.
 * Chat handling runs on async threads, so reads must be lock-free; writes happen
 * on the main thread from commands.
 */
public final class MuteStore {

    private final Map<UUID, MuteEntry> mutes = new ConcurrentHashMap<>();
    private final File file;
    private final Logger logger;

    public MuteStore(File file, Logger logger) {
        this.file = file;
        this.logger = logger;
    }

    /** Returns the active mute for a player, or {@code null}. Expired mutes are dropped lazily. */
    public MuteEntry get(UUID uuid) {
        MuteEntry entry = mutes.get(uuid);
        if (entry == null) return null;
        if (entry.expired(System.currentTimeMillis())) {
            mutes.remove(uuid, entry);
            return null;
        }
        return entry;
    }

    public boolean isMuted(UUID uuid) {
        return get(uuid) != null;
    }

    public void put(UUID uuid, MuteEntry entry) {
        mutes.put(uuid, entry);
        save();
    }

    public MuteEntry remove(UUID uuid) {
        MuteEntry prev = mutes.remove(uuid);
        if (prev != null) save();
        return prev;
    }

    /** A snapshot of currently-active mutes, pruning expired ones. */
    public List<Map.Entry<UUID, MuteEntry>> active() {
        long now = System.currentTimeMillis();
        List<Map.Entry<UUID, MuteEntry>> out = new ArrayList<>();
        boolean pruned = false;
        for (Map.Entry<UUID, MuteEntry> e : mutes.entrySet()) {
            if (e.getValue().expired(now)) {
                mutes.remove(e.getKey(), e.getValue());
                pruned = true;
            } else {
                out.add(e);
            }
        }
        if (pruned) save();
        return out;
    }

    public void load() {
        mutes.clear();
        if (!file.exists()) return;
        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(file);
        ConfigurationSection root = yaml.getConfigurationSection("mutes");
        if (root == null) return;
        long now = System.currentTimeMillis();
        for (String key : root.getKeys(false)) {
            ConfigurationSection s = root.getConfigurationSection(key);
            if (s == null) continue;
            try {
                UUID uuid = UUID.fromString(key);
                MuteEntry entry = new MuteEntry(
                        s.getString("name", "unknown"),
                        s.getLong("until", 0L),
                        s.getString("reason", ""),
                        s.getString("source", "console"),
                        s.getLong("created", now));
                if (!entry.expired(now)) {
                    mutes.put(uuid, entry);
                }
            } catch (IllegalArgumentException ex) {
                logger.warning("Skipping malformed mute entry: " + key);
            }
        }
    }

    public synchronized void save() {
        YamlConfiguration yaml = new YamlConfiguration();
        for (Map.Entry<UUID, MuteEntry> e : mutes.entrySet()) {
            String base = "mutes." + e.getKey();
            MuteEntry v = e.getValue();
            yaml.set(base + ".name", v.name());
            yaml.set(base + ".until", v.until());
            yaml.set(base + ".reason", v.reason());
            yaml.set(base + ".source", v.source());
            yaml.set(base + ".created", v.created());
        }
        try {
            File parent = file.getParentFile();
            if (parent != null) parent.mkdirs();
            yaml.save(file);
        } catch (IOException ex) {
            logger.log(Level.SEVERE, "Failed to save mutes to " + file, ex);
        }
    }
}
