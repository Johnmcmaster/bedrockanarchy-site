# NoCoords forum backend

The real server behind the forum, packaged so it can run **inside your
Minecraft server as a plugin** — or on its own with plain `java -jar` if the
host isn't Bukkit-family. One small jar, no libraries, no database server:
posts live in a single human-readable JSON file.

It implements the API contract in `../README.md` exactly, and it was tested
end-to-end against the real front-end pages before shipping (see Tests below).

## What it refuses to know

The privacy rules from the main README are enforced in code, not policy:

- **No access log exists.** Nothing about any request is ever written down.
- **IPs are never stored.** A client address is read once, fed into the
  poster-ID HMAC, and discarded. The HMAC secret lives only in memory and
  rotates every 24 hours, so poster IDs expire on their own and cannot be
  reversed into an address — not even by the operator.
- **No cookies, ever.** The server never sends `Set-Cookie`.
- **Proof of work is verified server-side.** Seeds are single-use, expire in
  five minutes, and are tracked in memory only.
- **Text only.** There is no multipart handler in the process; non-JSON
  bodies are rejected with 415. Uploads are impossible, not just forbidden.
- **Removal really removes.** A deleted post's body is blanked in the data
  file itself, so backups of the file honor removals automatically.
- Error responses and log lines never include request contents.

## Running as a plugin (Paper / Spigot / Bukkit)

1. Drop `dist/nocoords-backend-1.0.0.jar` into your server's `plugins/`
   folder and restart. The plugin only starts an HTTP listener — request
   handling runs on its own threads and never touches tick time.
2. Edit `plugins/NoCoordsForum/config.yml`:
   - `port` — the API's own TCP port (default 8321). On a shared host
     (UltraServers etc.), allocate an extra port in the panel first and use
     that.
   - `admin-key` — long random string; this is what the `#admin` box on the
     site asks for. Leaving it empty disables removal entirely.
   - `allowed-origin` — set to `https://nocoords.org` once live.
   - `proxy-ip-header` — set to `CF-Connecting-IP` if the API sits behind
     Cloudflare, so per-thread poster IDs key on the visitor rather than the
     proxy. (Stored nowhere either way.)
3. Restart again. Forum data lives in `plugins/NoCoordsForum/data.json`.

## Running on Nukkit-family servers

`dist/nocoords-backend-nukkit-1.0.0.jar` is the same backend with a
Nukkit/PowerNukkit entry point, for Bedrock servers that load Java plugins.
Drop it in `plugins/`; configuration is `plugins/NoCoordsForum/config.properties`
(same keys as the standalone properties file below). Ship only the variant
matching your server software — the other one logs a load error and is
ignored, but there is no reason to keep both.

## Running standalone

The same jar is its own process for anything that can run Java — including
keeping the forum off the game server entirely (which also means game
restarts don't blink the forum):

```sh
java -jar nocoords-backend-1.0.0.jar          # reads ./nocoords.properties
```

`nocoords.properties` takes the same keys as config.yml:

```properties
port=8321
admin-key=change-me
allowed-origin=https://nocoords.org
proxy-ip-header=
data-file=nocoords-data.json
```

If your Minecraft server is Bedrock Dedicated Server or PocketMine (which
don't load Java plugins), standalone mode is the way to run this.

## Pointing the site at it

In `forum/api.js` set:

```js
const BACKEND = "http";
const API_BASE = "https://api.nocoords.org/api";
```

and add the API origin to `connect-src` in the CSP `<meta>` tag of the three
HTML pages.

**HTTPS matters:** the site is served over HTTPS, so browsers will refuse a
plain-HTTP API. The no-extra-server path is Cloudflare in front of the API
port: an `api` DNS record (proxied) pointing at the game host, plus an Origin
Rule rewriting the destination port to your API port. Then `API_BASE` is a
normal `https://` URL and the plugin itself never needs a certificate. Set
`proxy-ip-header: "CF-Connecting-IP"` when you do this.

## Boards

The five boards from the mock are seeded on first run. To add or edit
boards, stop the server and edit the `boards` array in the data file — it is
ordinary JSON.

## Building from source

```sh
cd forum/backend-plugin
gradle jar        # needs Java 17+; fetches only the Paper API (compile-only)
```

The output jar contains nothing but this plugin's classes; the Paper API is
provided by the server at runtime and the standalone path is pure JDK.

## Tests

- `test/api.test.py` — 36 checks against a running backend: the whole
  contract, proof-of-work replay rejection, size limits, multipart
  rejection, admin auth, removal blanking, CORS preflight, security headers.
- `test/integration.test.mjs` — Playwright driving the real front-end pages
  (switched to `BACKEND="http"`) against the backend: posting a thread and
  reply through the browser with real proof of work, server-derived poster
  IDs matching the `you` field, formatting round-trip, operator removal
  through the UI, and assertions that no cookie is ever set and no request
  leaves the two origins under test.

Both suites pass against `dist/nocoords-backend-1.0.0.jar`.
