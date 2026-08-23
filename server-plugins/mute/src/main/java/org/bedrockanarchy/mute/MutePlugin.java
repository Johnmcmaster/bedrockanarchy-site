package org.bedrockanarchy.mute;

import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.OfflinePlayer;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabExecutor;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerChatEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * BedrockAnarchy mute system.
 *
 * <p>Muted players cannot send public chat or use the common private-message
 * commands. Mutes may be permanent or timed, persist across restarts, and are
 * keyed by UUID so they survive name changes (and work for Bedrock/Floodgate
 * players, whose UUIDs are stable).</p>
 */
public final class MutePlugin extends JavaPlugin implements Listener, TabExecutor {

    /** Message commands a muted player must not be able to use to bypass chat. */
    private static final List<String> BLOCKED_COMMANDS = Arrays.asList(
            "msg", "tell", "w", "whisper", "m", "r", "reply",
            "me", "say", "broadcast", "bc", "emsg", "epm", "pm");

    private static final String PREFIX = ChatColor.GRAY + "[" + ChatColor.RED + "Mute"
            + ChatColor.GRAY + "] " + ChatColor.RESET;

    private MuteStore store;

    @Override
    public void onEnable() {
        this.store = new MuteStore(new File(getDataFolder(), "mutes.yml"), getLogger());
        store.load();

        getServer().getPluginManager().registerEvents(this, this);
        bind("mute");
        bind("unmute");
        bind("mutelist");

        getLogger().info("BedrockAnarchyMute enabled (" + store.active().size() + " active mutes).");
    }

    @Override
    public void onDisable() {
        if (store != null) store.save();
    }

    private void bind(String name) {
        if (getCommand(name) != null) {
            getCommand(name).setExecutor(this);
            getCommand(name).setTabCompleter(this);
        }
    }

    // ---------------------------------------------------------------- chat gate

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onChat(AsyncPlayerChatEvent event) {
        MuteEntry entry = store.get(event.getPlayer().getUniqueId());
        if (entry == null) return;
        event.setCancelled(true);
        notifyMuted(event.getPlayer(), entry);
    }

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onCommand(PlayerCommandPreprocessEvent event) {
        MuteEntry entry = store.get(event.getPlayer().getUniqueId());
        if (entry == null) return;

        String message = event.getMessage();
        int space = message.indexOf(' ');
        String label = (space == -1 ? message.substring(1) : message.substring(1, space))
                .toLowerCase(Locale.ROOT);
        int colon = label.indexOf(':'); // strip plugin-qualified form like minecraft:me
        if (colon != -1) label = label.substring(colon + 1);

        if (BLOCKED_COMMANDS.contains(label)) {
            event.setCancelled(true);
            notifyMuted(event.getPlayer(), entry);
        }
    }

    private void notifyMuted(Player player, MuteEntry entry) {
        long now = System.currentTimeMillis();
        String when = entry.permanent()
                ? ChatColor.RED + "permanently"
                : ChatColor.YELLOW + "for " + Durations.format(entry.remainingMillis(now));
        String line = PREFIX + ChatColor.WHITE + "You are muted " + when + ChatColor.WHITE + ".";
        if (entry.reason() != null && !entry.reason().isEmpty()) {
            line += ChatColor.GRAY + " Reason: " + ChatColor.WHITE + entry.reason();
        }
        player.sendMessage(line);
    }

    // ------------------------------------------------------------------ commands

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        switch (command.getName().toLowerCase(Locale.ROOT)) {
            case "mute":     return cmdMute(sender, args);
            case "unmute":   return cmdUnmute(sender, args);
            case "mutelist": return cmdMuteList(sender);
            default:         return false;
        }
    }

    private boolean cmdMute(CommandSender sender, String[] args) {
        if (args.length < 1) {
            sender.sendMessage(PREFIX + ChatColor.RED + "Usage: /mute <player> [duration] [reason]");
            sender.sendMessage(PREFIX + ChatColor.GRAY + "Duration examples: 30m, 2h, 7d, 1w, perm");
            return true;
        }

        OfflinePlayer target = resolve(args[0]);
        if (target == null || (target.getName() == null && !target.hasPlayedBefore() && !target.isOnline())) {
            sender.sendMessage(PREFIX + ChatColor.RED + "Never seen a player named '" + args[0] + "'.");
            return true;
        }
        if (isExempt(target)) {
            sender.sendMessage(PREFIX + ChatColor.RED + "That player is exempt from muting.");
            return true;
        }

        long durationMillis = 0L;
        int reasonStart = 1;
        if (args.length >= 2) {
            long parsed = Durations.parse(args[1]);
            if (parsed >= 0L) {
                durationMillis = parsed;
                reasonStart = 2;
            } // else: treat args[1] as the first word of the reason (permanent mute)
        }

        long until = durationMillis == 0L ? 0L : System.currentTimeMillis() + durationMillis;
        String reason = args.length > reasonStart
                ? String.join(" ", Arrays.copyOfRange(args, reasonStart, args.length))
                : "";
        String source = sender instanceof Player ? sender.getName() : "Console";
        String name = target.getName() != null ? target.getName() : args[0];

        store.put(target.getUniqueId(),
                new MuteEntry(name, until, reason, source, System.currentTimeMillis()));

        String span = until == 0L ? "permanently" : "for " + Durations.format(durationMillis);
        sender.sendMessage(PREFIX + ChatColor.GREEN + "Muted " + ChatColor.WHITE + name
                + ChatColor.GREEN + " " + span
                + (reason.isEmpty() ? "" : ChatColor.GRAY + " (" + reason + ")") + ChatColor.GREEN + ".");

        Player online = target.getPlayer();
        if (online != null) {
            String msg = PREFIX + ChatColor.WHITE + "You have been muted " + span
                    + (reason.isEmpty() ? "" : ChatColor.GRAY + " - " + ChatColor.WHITE + reason) + ".";
            online.sendMessage(msg);
        }
        return true;
    }

    private boolean cmdUnmute(CommandSender sender, String[] args) {
        if (args.length < 1) {
            sender.sendMessage(PREFIX + ChatColor.RED + "Usage: /unmute <player>");
            return true;
        }
        OfflinePlayer target = resolve(args[0]);
        UUID uuid = target != null ? target.getUniqueId() : null;
        if (uuid == null || !store.isMuted(uuid)) {
            sender.sendMessage(PREFIX + ChatColor.RED + "That player is not muted.");
            return true;
        }
        MuteEntry prev = store.remove(uuid);
        String name = prev != null ? prev.name() : args[0];
        sender.sendMessage(PREFIX + ChatColor.GREEN + "Unmuted " + ChatColor.WHITE + name + ChatColor.GREEN + ".");
        if (target.getPlayer() != null) {
            target.getPlayer().sendMessage(PREFIX + ChatColor.GREEN + "You have been unmuted.");
        }
        return true;
    }

    private boolean cmdMuteList(CommandSender sender) {
        List<Map.Entry<UUID, MuteEntry>> active = store.active();
        if (active.isEmpty()) {
            sender.sendMessage(PREFIX + ChatColor.GRAY + "No players are currently muted.");
            return true;
        }
        long now = System.currentTimeMillis();
        sender.sendMessage(PREFIX + ChatColor.WHITE + "Muted players (" + active.size() + "):");
        for (Map.Entry<UUID, MuteEntry> e : active) {
            MuteEntry v = e.getValue();
            String when = v.permanent() ? ChatColor.RED + "permanent"
                    : ChatColor.YELLOW + Durations.format(v.remainingMillis(now)) + " left";
            String reason = v.reason() == null || v.reason().isEmpty()
                    ? "" : ChatColor.GRAY + " - " + v.reason();
            sender.sendMessage(ChatColor.GRAY + " - " + ChatColor.WHITE + v.name()
                    + ChatColor.GRAY + " (" + when + ChatColor.GRAY + ")" + reason);
        }
        return true;
    }

    // ------------------------------------------------------------------- helpers

    @SuppressWarnings("deprecation")
    private OfflinePlayer resolve(String name) {
        Player online = Bukkit.getPlayerExact(name);
        if (online != null) return online;
        // getOfflinePlayer(String) is deprecated but is the only name->UUID lookup
        // available without a Mojang API call, which Bedrock/Floodgate names lack anyway.
        return Bukkit.getOfflinePlayer(name);
    }

    private boolean isExempt(OfflinePlayer target) {
        Player online = target.getPlayer();
        return online != null && online.hasPermission("bedrockanarchy.mute.exempt");
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        String name = command.getName().toLowerCase(Locale.ROOT);
        if (name.equals("mutelist")) return new ArrayList<>();

        if (args.length == 1) {
            String partial = args[0].toLowerCase(Locale.ROOT);
            List<String> out = new ArrayList<>();
            if (name.equals("unmute")) {
                for (Map.Entry<UUID, MuteEntry> e : store.active()) {
                    if (e.getValue().name().toLowerCase(Locale.ROOT).startsWith(partial)) {
                        out.add(e.getValue().name());
                    }
                }
            } else {
                for (Player p : Bukkit.getOnlinePlayers()) {
                    if (p.getName().toLowerCase(Locale.ROOT).startsWith(partial)) out.add(p.getName());
                }
            }
            return out;
        }
        if (name.equals("mute") && args.length == 2) {
            List<String> out = new ArrayList<>();
            for (String s : Arrays.asList("30m", "1h", "6h", "1d", "7d", "perm")) {
                if (s.startsWith(args[1].toLowerCase(Locale.ROOT))) out.add(s);
            }
            return out;
        }
        return new ArrayList<>();
    }
}
