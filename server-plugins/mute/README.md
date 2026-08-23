# BedrockAnarchyMute

A small, persistent chat-mute plugin for the BedrockAnarchy server
(Paper / Spigot behind Geyser + Floodgate).

## What it does

- `/mute <player> [duration] [reason]` — mute a player. Duration is optional;
  omit it (or use `perm`) for a permanent mute. Examples: `30m`, `2h`, `7d`,
  `1w`, `1d3h`. Anything after the duration is treated as the reason.
- `/unmute <player>` — remove a mute.
- `/mutelist` — show everyone currently muted and their remaining time.

Muted players cannot use public chat or the common private-message commands
(`/msg`, `/tell`, `/w`, `/me`, `/say`, `/r`, …). They get told they are muted
and how long is left.

## Details

- Mutes are keyed by **UUID**, so they survive name changes and work for
  Bedrock/Floodgate players (whose UUIDs are stable).
- Mutes persist across restarts in `plugins/BedrockAnarchyMute/mutes.yml`.
  Expired timed mutes are pruned automatically.
- Permission `bedrockanarchy.mute` (default: op) is required to use the
  commands. Give someone `bedrockanarchy.mute.exempt` to make them unmutable.

## Build

Requires JDK 17+ and Maven.

```
mvn -f server-plugins/mute/pom.xml clean package
```

The jar is written to `server-plugins/mute/target/BedrockAnarchyMute-1.0.0.jar`.

## Install

Drop the jar into the server's `plugins/` folder and restart (or
`/reload confirm`). Built against the Paper 1.20.4 API; loads on Paper/Spigot
1.20+ (the chat listener uses the long-standing `AsyncPlayerChatEvent`).
