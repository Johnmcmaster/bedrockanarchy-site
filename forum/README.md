# NoCoords forum

Anonymous, text-only message board for the Minecraft anarchy scene — any
server, any edition, not just BedrockAnarchy. No accounts, no uploads, no
tracking.

Current state: **front-end complete, running against a mock backend.** Every
post lives in the visitor's own `localStorage`, so nothing is shared between
browsers yet. The UI, the crypto, and the anti-spam are all real and final —
only the storage is fake.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Board list plus recent threads |
| `board.html` | Threads on one board, plus the new-thread composer |
| `thread.html` | One thread, its replies, and the reply composer |
| `forum.css` | All styling. No webfont, no `@import`, no external asset |
| `forum.js` | UI logic for all three pages, branching on `<body data-page>` |
| `api.js` | Data layer. **The only file that changes when the backend lands** |
| `crypto.js` | Optional per-post end-to-end encryption |
| `pow.js` | Proof-of-work spam control |

No build step. It is static files; open `index.html` through any local web
server (ES modules will not load over `file://`).

## Tests

`test/ui.test.mjs` drives the whole thing in a real browser: posting, proof of
work, the sealed-post round trip, operator removal, XSS escaping, mobile
layout, and an assertion that the pages make **no request off-origin**.

```sh
npm i playwright && npx playwright install chromium
python3 -m http.server 8099     # from the repo root
node forum/test/ui.test.mjs
```

## Going live

Set `BACKEND = "http"` and `API_BASE` in `api.js`, then implement the contract
below. Nothing else in the codebase needs to change.

### API contract

```
GET    /api/boards
       -> [{ id, name, description, threadCount }]

GET    /api/boards/:boardId/threads
       -> [{ id, boardId, subject, excerpt, replyCount, createdAt, bumpedAt }]
          sorted by bumpedAt desc

GET    /api/threads/:threadId
       -> { thread: { id, boardId, subject, createdAt, bumpedAt },
            posts: [{ id, threadId, posterId, body, createdAt, removed }] }
          sorted by createdAt asc

GET    /api/challenge
       -> { seed, difficulty }        seed must be single-use and expire (~5 min)

POST   /api/threads
       <- { boardId, subject, body, proof: { seed, nonce } }
       -> { threadId }

POST   /api/threads/:threadId/posts
       <- { body, proof: { seed, nonce } }
       -> { postId }

DELETE /api/posts/:postId             header: X-Admin-Key
       -> { removed: true }
```

Timestamps are epoch milliseconds. All bodies are UTF-8 text; a body beginning
`nc1.` is a sealed post and the server must store it verbatim without trying to
parse it.

### Server-side rules that carry the privacy promise

The front-end can only avoid *creating* identifying data. Everything below is
the server's job, and skipping any of it silently breaks what the site tells
visitors on the front page:

1. **Never write an IP to disk.** Not in access logs, not in the database, not
   in error traces. Turn off the web server's access log entirely, or set the
   client-address field to a constant.
2. **Verify proof of work server-side.** Re-hash `SHA-256(seed + ":" + nonce)`
   and require 16 leading zero bits. Track spent seeds in memory (not by IP) so
   a solution cannot be replayed.
3. **No cookies, no sessions, no `Set-Cookie`.** The client sends
   `credentials: "omit"` and expects nothing back.
4. **Derive `posterId` server-side**, from
   `HMAC(rotating_secret, threadId + client_ip)`, keeping the secret in memory
   and rotating it every 24h. That gives per-thread IDs that expire on their own
   and cannot be reversed into an IP. The IP is used and discarded, never
   stored. (The mock derives IDs client-side, which is unverifiable — fine for a
   demo, wrong for production.)
5. **Strip identifying response headers** and send
   `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, HSTS, and
   the same CSP the pages carry in their `<meta>` tags — plus
   `frame-ancestors 'none'`, which browsers ignore in a `<meta>` tag and which
   therefore only works as a real response header.
6. **Reject non-text bodies.** No multipart handler should exist anywhere in the
   app. This is the single biggest reason the site stays online: without
   uploads, the worst illegal-content problem largely never arrives.
7. **Back up nothing that defeats removal.** If a post is deleted for legal
   reasons, it must be gone from backups too.

### Removal tooling

Removal is gated on a single operator key sent as `X-Admin-Key`. Append
`#admin` to any page URL to reveal the key box; the key is held in
`sessionStorage` and forgotten when the tab closes. The front-end gate is
cosmetic — the server must enforce the key on every `DELETE`.

Speech is not moderated. The delete lever exists so illegal content can be
pulled quickly, which is what keeps the registrar from taking the domain.

## Design notes

**Proof of work instead of rate limits.** Rate-limiting by IP means storing
IPs. Instead the browser burns ~16 bits of SHA-256 work per post: unnoticeable
once every few minutes, expensive at flood volume. No captcha and no
third-party challenge widget, both of which are trackers.

**Sealed posts are the only real secrecy on offer.** `crypto.js` does
PBKDF2-SHA256 (300k iterations) into AES-256-GCM, entirely in the browser. The
passphrase is never transmitted, so the operator genuinely cannot read a sealed
post. Ordinary posts are public — they are on a public board — and encrypting
them "at rest" with a key the site hands to every reader would be theatre, so
the site does not claim it.

**Poster IDs are a readability aid, not identity.** They let you follow a
back-and-forth inside a thread. They are random per thread and per tab, and
nothing about them persists.

**What this site cannot do.** It cannot hide a visitor's IP from the host or
from anyone watching the network. That needs Tor, and the front page says so
rather than implying the site handles it.

## Roadmap: live chat bridge

Planned after the forum backend lands: a live chat box on the site relaying
game chat across the operator's Minecraft servers and Discord, both
directions. Sketch, so the backend API can be shaped for it now:

```
[MC server 1]──console/ws──┐
[MC server 2]──console/ws──┤                  ┌──ws fan-out──> site chat box
[Discord]─────bot gateway──┼──bridge daemon───┤
                           │  (normalizes to  └──posts back──> MC + Discord
[site visitors]───PoW+ws───┘   one message
                               format)
```

- **Bridge daemon** (Node): one adapter per source. Bedrock servers via a
  WebSocket behavior pack or console pipe, Java servers via RCON/plugin,
  Discord via a bot on the gateway. Messages normalize to
  `{ source, name, text, ts }` and fan out to every other adapter.
- **Site side**: `GET /api/chat/ws` WebSocket, read for everyone. Sending
  from the site requires the same proof-of-work as posting, appears in game
  and Discord tagged `[web] Anonymous`, and carries the same no-IP-logging
  rule as the rest of the backend.
- **Anonymity note**: game and Discord chat is inherently public under its
  own usernames, and gets relayed as-is. Forum anonymity applies to what the
  site itself collects (nothing), not to what people say in game under their
  gamertag. The chat box is a window, not a confessional — the UI should say
  so.
- The bridge is operator-specific (it relays *your* servers). The boards
  stay scene-wide; the chat box is a feature of the site, not a scoping of
  it.
