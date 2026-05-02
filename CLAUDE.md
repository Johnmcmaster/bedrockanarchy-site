# bedrockanarchy-site — Claude Code Context

## Project Overview

This repo serves **bedrockanarchy.org:19132**, a Minecraft Bedrock anarchy server running
**NukkitPetteriM1Edition** (Java). The site assets are here; the actual Nukkit server runs
on an UltraServers Pterodactyl panel.

Server config key fact: `online-mode=false` — Xbox/Microsoft auth is **disabled**. This is
intentional (anarchy server) but it means anyone can claim any username/UUID/XUID.

---

## Active Branch

`claude/bedrock-protocol-sources-4mzvv`

All work goes here. Never push to main without explicit user permission.

---

## What Has Been Built

### 1. SimpleAuth Plugin (`plugins/simpleauth/`)
A password-authentication Endstone plugin (Python) for the Bedrock server.

- Source: `plugins/simpleauth/endstone_simpleauth/simpleauth_plugin.py`
- Manifest: `plugins/simpleauth/endstone_simpleauth/plugin.yml`
- Built wheel: `plugins/simpleauth/dist/endstone_simpleauth-1.0.0-py3-none-any.whl`

**Deployment**: Upload the `.whl` file to the Pterodactyl file manager under the
`plugins/` directory of the Nukkit server, then restart.

### 2. Bot System (`bots/`)
JavaScript bots that connect to bedrockanarchy.org using `bedrock-protocol`.
Most recent work: full `player_auth_input` packet implementation for authoritative
server-side movement. Bot connects, authenticates, wanders, and broadcasts position.

### 3. AnarchyGuard Plugin (`plugins/anarchyguard/`) — IN PROGRESS
A Java Nukkit plugin that patches the critical vulnerabilities found in the security
audit (see below). Only `plugin.yml` exists so far — the Java source needs to be written.

**Build target**: Maven JAR that drops into Nukkit's `plugins/` folder.

---

## Security Audit — NukkitPetteriM1Edition

A full audit was completed against the Nukkit source at
`https://github.com/PetteriM1/NukkitPetteriM1Edition` (cloned to `/tmp/nukkit-audit`
during the cloud session; you'll need to re-clone locally).

```
git clone https://github.com/PetteriM1/NukkitPetteriM1Edition.git /tmp/nukkit-audit
```

### CRITICAL — Full Server Takeover

**1. Op username spoofing** (`Server.java:2400`)
`isOp(String name)` checks by plain username string. With `online-mode=false` anyone can
log in as an op's username and gain full op privileges. Fix: require XUID match for ops.

**2. NPE crash on malformed login chain** (`ClientChainData.java:181-210`)
Chain validation catches `Throwable` and returns with `username = null`. Then
`Player.java:2937` calls `loginChainData.getUsername().length()` → NPE → server crash.
Any unauthenticated client sending a bad JWT chain can crash the server.

**3. `ClientToServerHandshakePacket` decode is empty** (`ClientToServerHandshakePacket.java:11-13`)
JWT validation is completely absent. The packet's `decode()` is a no-op.

### CRITICAL — Crashes / OOM

**4. NBT `ByteArrayTag` unbounded allocation** (`nbt/tag/ByteArrayTag.java:50-52`)
```java
int length = dis.readInt();
data = new byte[length];  // attacker sends length=2_000_000_000 → 2 GB OOM
```

**5. NBT `ListTag` unbounded allocation** (`nbt/tag/ListTag.java:91-99`)
`new ArrayList<>(size)` is only bounded when `suomiCraftPEMode=true` (default: off).

**6. `InventoryTransactionPacket` negative array size** (`network/protocol/InventoryTransactionPacket.java:82`)
```java
this.actions = new NetworkInventoryAction[Math.min((int) this.getUnsignedVarInt(), 4096)];
```
varint > `Integer.MAX_VALUE` → cast goes negative → `Math.min(-2_000_000_000, 4096)` = negative
→ `NegativeArraySizeException` → server crash.

**7. Resource pack chunk int overflow** (`Player.java:3105`)
`RESOURCE_PACK_CHUNK_SIZE * requestPacket.chunkIndex` — int overflow when `chunkIndex >= 262144`.

### HIGH — Economy / Item Duplication

**8. `matchItems()` skips NBT comparison** (`inventory/transaction/InventoryTransaction.java:235-256`)
`Item.equals(other)` doesn't compare NBT. Any item with different NBT passes as matching,
enabling item laundering / duplication.

**9. `CreativeInventoryAction.actionType` never set** (`inventory/transaction/action/CreativeInventoryAction.java:21-23`)
```java
public CreativeInventoryAction(Item source, Item target, int action) {
    super(source, target);
    // actionType never assigned — stays 0 = TYPE_DELETE_ITEM always
}
```
Bypasses `isCreativeItem()` allowlist check; creative players can obtain any item.

**10. `LoomItemAction` raw banner mutation** (`inventory/transaction/action/LoomItemAction.java:32-43`)
`banner.count -= sourceItem.getCount()` — `sourceItem.getCount()` is client-controlled.
Send negative count → free infinite banner patterns.

### HIGH — DoS / Amplification

**11. Resource pack chunks not rate-limited** (`Player.java:2812`)
`RESOURCE_PACK_CHUNK_REQUEST_PACKET` is excluded from the global packet rate limiter and
`resourceChunksRequested` map grows unbounded per-session.

**12. Chat flood** (`Player.java:4164`)
`packetBlocked(packet, 20, -1)` — threshold `-1` means never kick. Clients can send
400+ chat packets/second indefinitely.

**13. Map ID memory leak** (`Player.java:4299-4300`)
`lastMapRequest.put(pk.mapId, ...)` — `mapId` is a client-controlled 64-bit long, map
is never trimmed → unbounded memory growth per connected client.

**14. RakNet no per-IP connection limit** (`com/nukkitx/network/raknet/RakNetServer.java:126-178`)
`onConnectionRequest` always returns true; sessions keyed by (IP:port) not IP alone.
UDP source spoofing + handshake flood can exhaust session table.

### MEDIUM — Encryption / Integrity

**15. AES/CTR without MAC** (`network/session/RakNetPlayerSession.java:215-228`)
Decryption strips last 8 bytes without comparing them — ciphertext is malleable.
An on-path attacker (or anyone who knows the session key) can flip bits undetected.

### MEDIUM — Permission / Auth Bypass

**16. `PermissibleBase` fail-open** (`permission/PermissibleBase.java:111-121`)
Unknown permission name returns `isOp()` instead of `false`. Plugins that check
unconfigured permission nodes accidentally grant op access to all ops.

**17. Sign edit auth by UUID string** (`blockentity/BlockEntitySign.java:160`)
Sign ownership is checked by `UUID.toString()` — forgeable in offline mode.

### MEDIUM — Anti-Cheat Gaps

**18. Killaura protection gated on `suomiCraftPEMode`** (`Player.java:4970`)
```java
if (this.attacksPerTick > 10 && server.suomiCraftPEMode()) {
```
`suomiCraftPEMode` defaults to `false` → killaura protection is off by default.

**19. Survival reach = 5 blocks** (`Player.java:4939`)
`canInteractEntity(target, 25)` = 5 block reach in survival (vanilla = 3 blocks).
Reach hacks up to 5 blocks go undetected.

**20. Spawn protection ignores TNT explosions** (`level/Explosion.java`)
No `isInSpawnRadius()` check → TNT detonated near spawn can destroy spawn-protected blocks.

---

## AnarchyGuard Plugin — What Needs Building

The plugin skeleton is at `plugins/anarchyguard/`. The `plugin.yml` manifest is done.
Next: write the Java source at:
`plugins/anarchyguard/src/main/java/org/bedrockanarchy/anarchyguard/AnarchyGuard.java`

**Patches to implement (in priority order):**

1. **`PlayerAsyncPreLoginEvent`** — if `!chainData.isXboxAuthed()` and username matches a
   known op, kick with "Cannot join as operator username in offline mode".

2. **`PlayerAsyncPreLoginEvent`** — null-username guard: if `chainData.getUsername() == null`,
   call `event.disAllow("Invalid login chain")`.

3. **`DataPacketReceiveEvent`** — for `InventoryTransactionPacket`, re-validate
   `actions.length` after decode; if > 256, cancel and kick.

4. **`PlayerChatEvent`** — per-player chat timestamp tracking; if < 500ms since last
   message, cancel. Repeated violations kick.

5. **`EntityDamageByEntityEvent`** — if damager is `Player`, check ticks-since-last-attack;
   if < 2 ticks (killaura), cancel.

6. **`PlayerMoveEvent`** — basic speed cap: if distance > 0.7 blocks per tick while
   on ground and not elytra/horse/vehicle, cancel and teleport back.

The plugin needs a `pom.xml` with the Nukkit dependency and Maven Shade to build a fat JAR.

---

## Pterodactyl Deployment

Server is on UltraServers. Access via their web panel file manager. To deploy:
1. Upload JAR to `/plugins/` on the server
2. Restart via panel
3. Logs under `/logs/latest.log`

---

## Key File Paths (audit source, needs re-clone locally)

| Finding | File | Line |
|---------|------|------|
| Op spoofing | `src/main/java/cn/nukkit/Server.java` | 2400 |
| NPE crash | `src/main/java/cn/nukkit/Player.java` | 2937 |
| NBT OOM | `src/main/java/cn/nukkit/nbt/tag/ByteArrayTag.java` | 50 |
| Neg array size | `src/main/java/cn/nukkit/network/protocol/InventoryTransactionPacket.java` | 82 |
| Chat flood | `src/main/java/cn/nukkit/Player.java` | 4164 |
| Map ID leak | `src/main/java/cn/nukkit/Player.java` | 4299 |
| Killaura gate | `src/main/java/cn/nukkit/Player.java` | 4970 |
| Reach 5 blocks | `src/main/java/cn/nukkit/Player.java` | 4939 |
| Item dupe | `src/main/java/cn/nukkit/inventory/transaction/InventoryTransaction.java` | 235 |
| Creative bypass | `src/main/java/cn/nukkit/inventory/transaction/action/CreativeInventoryAction.java` | 21 |
| Fail-open perms | `src/main/java/cn/nukkit/permission/PermissibleBase.java` | 111 |
| Sign auth bypass | `src/main/java/cn/nukkit/blockentity/BlockEntitySign.java` | 160 |
