/*
 * NoCoords forum UI.
 *
 * One module, branching on <body data-page>. No framework, no build step, no
 * external requests at runtime.
 */

import { api, isMock, posterIdFor, POW_DIFFICULTY } from "./api.js";
import { solve } from "./pow.js";
import { isSealed, seal, unseal } from "./crypto.js";

const MAX_BODY = 8000;
const MAX_SUBJECT = 120;
const ADMIN_KEY_STORE = "nocoords.adminkey";

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const params = new URLSearchParams(location.search);

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/*
 * Links are rendered with no-referrer so clicking one never tells the
 * destination which thread the visitor came from, and nofollow so the board
 * cannot be farmed for SEO.
 */
function linkify(escaped) {
  return escaped.replace(/https?:\/\/[^\s<]+/g, (url) => {
    const trimmed = url.replace(/[.,;:)\]]+$/, "");
    const tail = url.slice(trimmed.length);
    return (
      `<a href="${trimmed}" target="_blank" rel="noopener noreferrer nofollow" `
      + `referrerpolicy="no-referrer">${trimmed}</a>${tail}`
    );
  });
}

/*
 * Per-thread handles. Derived from the same anonymous per-thread ID, so they
 * carry no more identity than the ID does: same person, same thread, same
 * handle; different thread or tomorrow, a different one. Just friendlier to
 * read than hex.
 */
const HANDLE_A = [
  "Void", "Obsidian", "Creeper", "Phantom", "Wither", "Lava", "Bedrock", "Ender",
  "Nether", "Feral", "Rogue", "Silent", "Hollow", "Ashen", "Gilded", "Cursed",
];
const HANDLE_B = [
  "Drifter", "Miner", "Ghost", "Raider", "Wanderer", "Pilgrim", "Hermit", "Looter",
  "Builder", "Nomad", "Scout", "Warden", "Digger", "Smith", "Trapper", "Voyager",
];

function handleFor(posterId) {
  const a = parseInt(posterId.slice(0, 2), 16) % HANDLE_A.length;
  const b = parseInt(posterId.slice(2, 4), 16) % HANDLE_B.length;
  return HANDLE_A[a] + HANDLE_B[b];
}

/* Discord-style name color, derived from the same ID. */
function handleColor(posterId) {
  const hue = parseInt(posterId.slice(0, 4), 16) % 360;
  return `hsl(${hue}, 55%, 38%)`;
}

/* ">>p3" quotes another post in the thread; a single ">" line is greentext. */
function postRefs(escaped) {
  return escaped.replace(/&gt;&gt;(p\d+)/g,
    '<a class="post-ref" href="#post-$1">&gt;&gt;$1</a>');
}

/*
 * Minecraft-style "\u00a7" formatting codes: \u00a70-\u00a7f colors, \u00a7l bold, \u00a7o italic,
 * \u00a7n underline, \u00a7m strikethrough, \u00a7k obfuscated, \u00a7r reset. Runs on escaped
 * HTML and skips existing tags, closing spans at tag boundaries so nesting
 * stays valid.
 */
function mcFormat(html) {
  if (!html.includes("\u00a7")) return html;
  const state = { color: null, l: false, o: false, n: false, m: false, k: false };
  const wrap = (text) => {
    if (!text) return "";
    const cls = [];
    if (state.color) cls.push("mc-" + state.color);
    for (const f of ["l", "o", "n", "m", "k"]) if (state[f]) cls.push("mc-" + f);
    return cls.length ? `<span class="${cls.join(" ")}">${text}</span>` : text;
  };
  return html.split(/(<[^>]*>)/).map((chunk) => {
    if (chunk.startsWith("<")) return chunk;
    let out = "";
    let buf = "";
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      const next = chunk[i + 1]?.toLowerCase();
      if (ch === "\u00a7" && next && /[0-9a-fk-or]/.test(next)) {
        out += wrap(buf);
        buf = "";
        i++;
        if (/[0-9a-f]/.test(next)) {
          state.color = next;
          state.l = state.o = state.n = state.m = state.k = false;
        } else if (next === "r") {
          state.color = null;
          state.l = state.o = state.n = state.m = state.k = false;
        } else {
          state[next] = true;
        }
      } else {
        buf += ch;
      }
    }
    return out + wrap(buf);
  }).join("");
}

/* \u00a7k text scrambles like the game's obfuscated style. */
const OBF_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789!@#$%&*+=?";
let obfTimer = null;
function ensureObfuscation() {
  if (obfTimer || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  obfTimer = setInterval(() => {
    document.querySelectorAll(".mc-k").forEach((node) => {
      if (!node.dataset.obf) node.dataset.obf = node.textContent;
      node.textContent = [...node.dataset.obf]
        .map((c) => (/\s/.test(c) ? c : OBF_CHARS[Math.floor(Math.random() * OBF_CHARS.length)]))
        .join("");
    });
  }, 70);
}

/* Slash commands, offered by the composer palette. */
const COMMANDS = [
  { name: "book", desc: "Write a multi-page book (pages split with ---)" },
  { name: "mojangles", desc: "Write in the pixel font" },
];

function parseMojangles(body) {
  const m = body.match(/^\/mojangles(?:\s+([\s\S]*))?$/);
  return m ? (m[1] ?? "").trim() : null;
}

function greentext(escaped) {
  return escaped
    .split("\n")
    .map((line) => (/^&gt;(?!&gt;)/.test(line) ? `<span class="greentext">${line}</span>` : line))
    .join("\n");
}

function renderBody(body) {
  return greentext(mcFormat(postRefs(linkify(escapeHtml(body)))));
}

function timeAgo(timestamp) {
  const seconds = Math.max(Math.floor((Date.now() - timestamp) / 1000), 0);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d ago` : `${Math.floor(days / 30)}mo ago`;
}

function el(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

function setStatus(node, message, isError = false) {
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("status-error", isError);
}


/* ------------------------------------------------------------------ *
 * /book posts — Minecraft-style written books
 * ------------------------------------------------------------------ */

/*
 * A post whose first line is "/book Title" renders as a clickable book.
 * Pages are separated by a line containing only "---"; pages longer than
 * the in-game-ish limit are split automatically. Hard cap of 50 pages.
 *
 * The reader shows a Bedrock-style two-page spread. The open-book artwork
 * (assets/book_open.png) and the 16x16 item icon are fan art supplied by
 * the site owner; the remaining chrome is original work. No Mojang texture
 * files are shipped — game assets are copyrighted.
 */
const BOOK_MAX_PAGES = 50;
const BOOK_PAGE_CHARS = 300;

function parseBook(body) {
  if (!/^\/book(\s|$)/.test(body)) return null;
  const lines = body.split("\n");
  const title = lines[0].replace(/^\/book\s*/, "").trim() || "Untitled";
  const rest = lines.slice(1).join("\n").trim();
  const rawPages = rest ? rest.split(/\n\s*---\s*\n/) : [""];
  const pages = [];

  for (const raw of rawPages) {
    if (pages.length >= BOOK_MAX_PAGES) break;
    let text = raw.trim();
    if (!text) {
      pages.push("");
      continue;
    }
    while (text.length > BOOK_PAGE_CHARS && pages.length < BOOK_MAX_PAGES - 1) {
      let cut = text.lastIndexOf(" ", BOOK_PAGE_CHARS);
      if (cut < BOOK_PAGE_CHARS * 0.5) cut = BOOK_PAGE_CHARS;
      pages.push(text.slice(0, cut).trim());
      text = text.slice(cut).trim();
    }
    pages.push(text);
  }

  return { title, pages: pages.slice(0, BOOK_MAX_PAGES) };
}

/* 16x16 book item icon — pixel art supplied by the site owner. */
const BOOK_PIXELS = [
  "................",
  "........BBB.....",
  "......BBcccB....",
  "....BBccdcccB...",
  "..BBccccdddccB..",
  "BBcccdcccdddccB.",
  "Bhccccdcccccccps",
  "Bhhcccccccccppxy",
  "Bhxhccccccppzxzy",
  "shwxhcccppxzxzts",
  ".shwxhppxzzxttss",
  "..shwxxxzxttss..",
  "...shwzzttss....",
  "....shttss......",
  ".....sss........",
  "................",
];
const BOOK_COLORS = {
  B: "#402d00",
  c: "#876826",
  d: "#36280c",
  h: "#87754e",
  p: "#5c4000",
  s: "#000000",
  x: "#b8b8b8",
  y: "#525252",
  z: "#858585",
  w: "#d9d9d9",
  t: "#452f00",
};

function bookIconSvg() {
  let rects = "";
  BOOK_PIXELS.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const color = BOOK_COLORS[ch];
      if (color) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"/>`;
    });
  });
  return `<svg viewBox="0 0 16 16" width="22" height="22" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

function renderBookPage(text) {
  return greentext(mcFormat(linkify(escapeHtml(text))));
}

/*
 * Local-only texture overrides. Off by default and opt-in via
 * localStorage.setItem("nocoords.textures", "1"), so ordinary visitors never
 * probe for the files. When enabled, drop-in PNGs from forum/textures/
 * replace the built-in art:
 *
 *   textures/book_page.png     the open-book reading background (cropped)
 *   textures/written_book.png  the 16x16 book item icon
 *
 * The directory is gitignored on purpose: extracting assets from your own
 * game copy for local use is your business, but committing or deploying
 * them redistributes Mojang's copyrighted files. Keep them local.
 */
let bookTextures = null;

function texturesEnabled() {
  try {
    return localStorage.getItem("nocoords.textures") === "1";
  } catch {
    return false;
  }
}

function probeTexture(path) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(path);
    img.onerror = () => resolve(null);
    img.src = path;
  });
}

async function loadBookTextures() {
  if (!texturesEnabled()) return;
  const [page, icon] = await Promise.all([
    probeTexture("textures/book_page.png"),
    probeTexture("textures/written_book.png"),
  ]);
  bookTextures = { page, icon };
  if (page) document.documentElement.classList.add("has-book-page-texture");
}

function bookNode(book) {
  const icon = bookTextures?.icon
    ? `<img class="book-icon-img" src="${bookTextures.icon}" width="22" height="22" alt="">`
    : bookIconSvg();
  const node = el(`
    <button class="book-inline" type="button" title="Read this book">
      ${icon}
      <span class="book-inline-title">${escapeHtml(book.title)}</span>
      <span class="book-inline-pages">${book.pages.length} page${book.pages.length === 1 ? "" : "s"}</span>
    </button>
  `);
  node.addEventListener("click", () => openBook(book));
  return node;
}

const ARROW_RIGHT = `<svg viewBox="0 0 18 10" width="27" height="15" shape-rendering="crispEdges" aria-hidden="true">
  <path fill="#4a3a28" d="M0 3h10V0h2v1h2v1h2v1h2v2h-2v1h-2v1h-2v1h-2v-3H0z"/>
  <path fill="#8a7350" d="M1 4h9V2h1v1h2v1h2v1h-2v1h-2v1h-1V5H1z"/></svg>`;
const ARROW_LEFT = `<svg viewBox="0 0 18 10" width="27" height="15" shape-rendering="crispEdges" aria-hidden="true">
  <path fill="#4a3a28" d="M18 3H8V0H6v1H4v1H2v1H0v2h2v1h2v1h2v1h2V5h10z"/>
  <path fill="#8a7350" d="M17 4H8V2H7v1H5v1H3v1h2v1h2v1h1V5h9z"/></svg>`;

function openBook(book) {
  let spread = 0; // index of the left-hand page

  const overlay = el(`
    <div class="book-overlay" role="dialog" aria-modal="true" aria-label="${escapeHtml(book.title)}">
      <div class="book-wrap">
        <div class="book-gui">
          <div class="book-col book-col-left">
            <div class="book-page-num"></div>
            <div class="book-page-text"></div>
          </div>
          <div class="book-col book-col-right">
            <div class="book-page-num"></div>
            <div class="book-page-text"></div>
          </div>
          <button class="book-arrow book-arrow-prev" type="button" aria-label="Previous pages">${ARROW_LEFT}</button>
          <button class="book-arrow book-arrow-next" type="button" aria-label="Next pages">${ARROW_RIGHT}</button>
        </div>
        <button class="mc-button book-done" type="button">Done</button>
      </div>
    </div>
  `);

  const cols = overlay.querySelectorAll(".book-col");
  const prev = overlay.querySelector(".book-arrow-prev");
  const next = overlay.querySelector(".book-arrow-next");
  const total = book.pages.length;

  function paint(direction) {
    [0, 1].forEach((offset) => {
      const i = spread + offset;
      const col = cols[offset];
      const has = i < total;
      col.querySelector(".book-page-num").textContent = has ? `Page ${i + 1} of ${total}` : "";
      const textNode = col.querySelector(".book-page-text");
      textNode.innerHTML = has ? renderBookPage(book.pages[i]) : "";
      textNode.classList.remove("book-write");
      void textNode.offsetWidth;
      textNode.classList.add("book-write");
    });
    prev.hidden = spread === 0;
    next.hidden = spread + 2 >= total;
    if (direction) {
      cols.forEach((col) => {
        col.classList.remove("book-turn-left", "book-turn-right");
        void col.offsetWidth;
        col.classList.add(direction === 1 ? "book-turn-right" : "book-turn-left");
      });
    }
  }

  function flip(delta) {
    const target = spread + delta * 2;
    if (target < 0 || target >= total) return;
    spread = target;
    paint(delta);
  }

  function close() {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  }

  function onKey(event) {
    if (event.key === "Escape") close();
    if (event.key === "ArrowRight") flip(1);
    if (event.key === "ArrowLeft") flip(-1);
  }

  prev.addEventListener("click", () => flip(-1));
  next.addEventListener("click", () => flip(1));
  overlay.querySelector(".book-done").addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);

  paint();
  document.body.append(overlay);
  overlay.querySelector(".book-done").focus();
}

/* ------------------------------------------------------------------ *
 * Admin key (removal tooling)
 * ------------------------------------------------------------------ */

/*
 * There are no accounts, so removal is gated on a shared key the operator
 * holds. The key lives in sessionStorage only, so closing the tab forgets it.
 * Real enforcement belongs on the server; this only decides what the UI shows.
 */
const admin = {
  get key() {
    return sessionStorage.getItem(ADMIN_KEY_STORE) ?? "";
  },
  set key(value) {
    if (value) {
      sessionStorage.setItem(ADMIN_KEY_STORE, value);
    } else {
      sessionStorage.removeItem(ADMIN_KEY_STORE);
    }
  },
  get active() {
    return Boolean(this.key);
  },
};

function initAdminBar(onChange) {
  const bar = document.querySelector("#admin-bar");
  if (!bar) return;

  function reveal() {
    bar.classList.toggle("is-active", location.hash === "#admin" || admin.active);
  }

  reveal();

  // Appending #admin to the URL of the page you are already on is a
  // same-document navigation, so nothing reloads. Listen for it explicitly.
  window.addEventListener("hashchange", reveal);

  const input = bar.querySelector("#admin-key");
  const apply = bar.querySelector("#admin-apply");
  const clear = bar.querySelector("#admin-clear");
  const state = bar.querySelector("#admin-state");

  function paint() {
    state.textContent = admin.active ? "unlocked" : "locked";
  }

  apply?.addEventListener("click", () => {
    admin.key = input.value.trim();
    input.value = "";
    paint();
    onChange?.();
  });

  clear?.addEventListener("click", () => {
    admin.key = "";
    paint();
    reveal();
    onChange?.();
  });

  paint();
}

/* ------------------------------------------------------------------ *
 * Composer (shared by new-thread and reply)
 * ------------------------------------------------------------------ */

/**
 * Wires a composer form. `submit` receives { subject, body, proof } and does
 * the actual API call.
 */
function initComposer(form, { withSubject, submit, draftKey }) {
  if (!form) return;

  const bodyInput = form.querySelector("[name=body]");

  // Slash-command palette: type "/" as the first thing in the box and pick
  // a command with fuzzy matching, arrows, and Enter.
  const palette = document.createElement("div");
  palette.className = "cmd-palette";
  palette.hidden = true;
  bodyInput.insertAdjacentElement("afterend", palette);

  /*
   * In-place live formatting. A styled backdrop sits exactly behind the
   * textarea; when the draft uses \u00a7 codes or /mojangles the textarea's own
   * text goes transparent (caret stays native) and the styled copy shows
   * through. The \u00a7 codes stay visible but dimmed so every character lines
   * up 1:1 with the caret. Bold is faked with a text-shadow and italic with
   * synthetic oblique so glyph widths never change.
   */
  const editorWrap = document.createElement("div");
  editorWrap.className = "editor-wrap";
  bodyInput.before(editorWrap);
  const backdrop = document.createElement("div");
  backdrop.className = "editor-backdrop";
  backdrop.setAttribute("aria-hidden", "true");
  editorWrap.append(backdrop, bodyInput);
  bodyInput.classList.add("editor-input");

  function escapeChar(c) {
    return c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c;
  }

  function renderEditor() {
    const value = bodyInput.value;
    const moj = /^\/mojangles(\s|$)/.test(value);
    editorWrap.classList.toggle("mojangles-mode", moj);
    const active = moj || value.includes("\u00a7");
    editorWrap.classList.toggle("editor-live", active);
    if (!active) {
      backdrop.innerHTML = "";
      return;
    }

    const state = { color: null, l: false, o: false, n: false, m: false, k: false };
    let out = "";
    let buf = "";
    const flush = () => {
      if (!buf) return;
      const cls = [];
      if (state.color) cls.push("mc-" + state.color);
      if (state.l) cls.push("e-l");
      if (state.o) cls.push("e-o");
      if (state.n) cls.push("mc-n");
      if (state.m) cls.push("mc-m");
      if (state.k) cls.push("mc-k");
      out += cls.length ? `<span class="${cls.join(" ")}">${buf}</span>` : buf;
      buf = "";
    };

    let i = 0;
    if (moj) {
      out += `<span class="e-code">/mojangles</span>`;
      i = "/mojangles".length;
    }
    for (; i < value.length; i++) {
      const c = value[i];
      const next = value[i + 1]?.toLowerCase();
      if (c === "\u00a7" && next && /[0-9a-fk-or]/.test(next)) {
        flush();
        i++;
        if (/[0-9a-f]/.test(next)) {
          state.color = next;
          state.l = state.o = state.n = state.m = state.k = false;
        } else if (next === "r") {
          state.color = null;
          state.l = state.o = state.n = state.m = state.k = false;
        } else {
          state[next] = true;
        }
        // The code token wears the formatting it introduces (minus the
        // scramble, which would garble the code while editing it).
        const codeCls = ["e-code"];
        if (state.color) codeCls.push("mc-" + state.color);
        if (state.l) codeCls.push("e-l");
        if (state.o) codeCls.push("e-o");
        if (state.n) codeCls.push("mc-n");
        if (state.m) codeCls.push("mc-m");
        out += `<span class="${codeCls.join(" ")}">\u00a7${escapeChar(value[i])}</span>`;
      } else {
        buf += escapeChar(c);
      }
    }
    flush();
    backdrop.innerHTML = out + "\n\u200b";
    backdrop.scrollTop = bodyInput.scrollTop;
  }

  bodyInput.addEventListener("scroll", () => {
    backdrop.scrollTop = bodyInput.scrollTop;
  });

  let palItems = [];
  let palIndex = 0;
  let palDismissed = false;

  function fuzzy(name, q) {
    let i = 0;
    const marks = [];
    for (const ch of name) {
      if (i < q.length && ch === q[i]) {
        marks.push(true);
        i++;
      } else {
        marks.push(false);
      }
    }
    return { hit: i === q.length, marks };
  }

  function paletteQuery() {
    const m = bodyInput.value.match(/^\/([a-z]*)$/i);
    return m ? m[1].toLowerCase() : null;
  }

  function pickCommand(cmd) {
    bodyInput.value = `/${cmd.name} `;
    palette.hidden = true;
    bodyInput.focus();
    bodyInput.dispatchEvent(new Event("input"));
  }

  function renderPalette() {
    const q = palDismissed ? null : paletteQuery();
    if (q === null) {
      palette.hidden = true;
      return;
    }
    palItems = COMMANDS
      .map((c) => ({ ...c, f: fuzzy(c.name, q) }))
      .filter((c) => c.f.hit);
    if (!palItems.length) {
      palette.hidden = true;
      return;
    }
    palIndex = Math.min(palIndex, palItems.length - 1);
    palette.innerHTML = "";
    palItems.forEach((c, i) => {
      const name = [...c.name]
        .map((ch, j) => (q && c.f.marks[j] ? `<b>${ch}</b>` : ch))
        .join("");
      const item = el(`
        <button type="button" class="cmd-item${i === palIndex ? " cmd-item-active" : ""}">
          <span class="cmd-name">/${name}</span>
          <span class="cmd-desc">${escapeHtml(c.desc)}</span>
        </button>`);
      item.addEventListener("click", () => pickCommand(c));
      palette.append(item);
    });
    palette.hidden = false;
  }

  bodyInput.addEventListener("input", () => {
    palDismissed = false;
    renderPalette();
    renderEditor();
  });
  bodyInput.addEventListener("keydown", (event) => {
    if (palette.hidden) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      palIndex = (palIndex + 1) % palItems.length;
      renderPalette();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      palIndex = (palIndex - 1 + palItems.length) % palItems.length;
      renderPalette();
    } else if ((event.key === "Enter" || event.key === "Tab") && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      pickCommand(palItems[palIndex]);
    } else if (event.key === "Escape") {
      palDismissed = true;
      palette.hidden = true;
    }
  });

  // Auto-grow as you type, up to half the screen.
  bodyInput.addEventListener("input", () => {
    bodyInput.style.height = "auto";
    bodyInput.style.height = `${Math.min(bodyInput.scrollHeight, window.innerHeight / 2)}px`;
  });

  // Ctrl/Cmd+Enter posts.
  bodyInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  // Keep an unsent draft so a stray tap doesn't eat the post.
  if (draftKey) {
    try {
      const saved = sessionStorage.getItem(draftKey);
      if (saved) {
        bodyInput.value = saved;
        renderEditor();
      }
    } catch { /* storage unavailable */ }
    bodyInput.addEventListener("input", () => {
      try {
        if (bodyInput.value) sessionStorage.setItem(draftKey, bodyInput.value);
        else sessionStorage.removeItem(draftKey);
      } catch { /* ignore */ }
    });
  }

  // Character count, shown only when it starts to matter.
  const counter = document.createElement("span");
  counter.className = "char-count";
  counter.hidden = true;
  form.querySelector(".composer-actions")?.append(counter);
  bodyInput.addEventListener("input", () => {
    const left = MAX_BODY - bodyInput.value.length;
    counter.hidden = left > 500;
    counter.textContent = `${left}`;
    counter.classList.toggle("char-count-low", left < 50);
  });
  const subjectInput = form.querySelector("[name=subject]");
  const sealToggle = form.querySelector("[name=sealed]");
  const passInput = form.querySelector("[name=passphrase]");
  const passField = form.querySelector("#pass-field");
  const submitButton = form.querySelector("[type=submit]");
  const status = form.querySelector(".status");

  sealToggle?.addEventListener("change", () => {
    passField.hidden = !sealToggle.checked;
    if (sealToggle.checked) {
      passInput.focus();
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const body = bodyInput.value.trim();
    const subject = subjectInput?.value.trim() ?? "";

    if (!body) {
      setStatus(status, "Write something first.", true);
      return;
    }
    if (body.length > MAX_BODY) {
      setStatus(status, `Too long by ${body.length - MAX_BODY} characters.`, true);
      return;
    }
    if (withSubject && !subject) {
      setStatus(status, "A new thread needs a subject.", true);
      return;
    }
    if (subject.length > MAX_SUBJECT) {
      setStatus(status, "Subject is too long.", true);
      return;
    }
    if (sealToggle?.checked && !passInput.value) {
      setStatus(status, "Sealed posts need a passphrase.", true);
      return;
    }

    submitButton.disabled = true;

    try {
      let payloadBody = body;

      if (sealToggle?.checked) {
        setStatus(status, "Encrypting…");
        payloadBody = await seal(body, passInput.value);
      }

      setStatus(status, "Posting…");
      const challenge = await api.challenge();
      const proof = await solve(challenge);
      await submit({ subject, body: payloadBody, proof });

      bodyInput.value = "";
      renderEditor();
      bodyInput.style.height = "";
      if (passInput) passInput.value = "";
      if (draftKey) {
        try { sessionStorage.removeItem(draftKey); } catch { /* ignore */ }
      }
    } catch (error) {
      setStatus(status, error.message ?? "Something went wrong.", true);
      submitButton.disabled = false;
    }
  });
}

/* ------------------------------------------------------------------ *
 * Board index
 * ------------------------------------------------------------------ */

async function renderBoardIndex() {
  const target = document.querySelector("#board-grid");
  const boards = await api.listBoards();

  target.innerHTML = "";
  boards.forEach((board) => {
    target.append(
      el(`
        <a class="board-card" href="./board.html?b=${encodeURIComponent(board.id)}" title="${escapeHtml(board.description)}">
          <span class="board-slug">/${escapeHtml(board.id)}/</span>
          <h2>${escapeHtml(board.name)}</h2>
          <p>${escapeHtml(board.description)}</p>
          <span class="board-stat">${board.threadCount} thread${board.threadCount === 1 ? "" : "s"}</span>
        </a>
      `)
    );
  });

  const recentTarget = document.querySelector("#recent-threads");
  const recent = (await api.listThreads(null)).slice(0, 6);

  recentTarget.innerHTML = "";
  if (!recent.length) {
    recentTarget.append(el(`<p class="empty">Nothing posted yet.</p>`));
    return;
  }

  recent.forEach((thread) => recentTarget.append(threadRow(thread)));
}

function threadRow(thread) {
  return el(`
    <article class="thread-row">
      <h3><a href="./thread.html?t=${encodeURIComponent(thread.id)}">${escapeHtml(thread.subject)}</a></h3>
      <p class="thread-excerpt">${escapeHtml(thread.excerpt)}</p>
      <div class="thread-meta">
        <span>/${escapeHtml(thread.boardId)}/</span>
        <span>${thread.replyCount} repl${thread.replyCount === 1 ? "y" : "ies"}</span>
        <span>bumped ${timeAgo(thread.bumpedAt)}</span>
      </div>
    </article>
  `);
}

/* ------------------------------------------------------------------ *
 * Board view
 * ------------------------------------------------------------------ */

async function renderBoard() {
  const boardId = params.get("b") ?? "b";
  const boards = await api.listBoards();
  const board = boards.find((item) => item.id === boardId) ?? boards[0];

  document.title = `/${board.id}/ ${board.name} — NoCoords`;
  document.querySelector("#board-name").textContent = `/${board.id}/ ${board.name}`;
  document.querySelector("#board-description").textContent = board.description;

  const list = document.querySelector("#thread-list");

  async function paint() {
    const threads = await api.listThreads(board.id);
    list.innerHTML = "";
    if (!threads.length) {
      list.append(el(`<p class="empty">No threads on this board yet. Start one.</p>`));
      return;
    }
    threads.forEach((thread) => list.append(threadRow(thread)));
  }

  await paint();

  initComposer(document.querySelector("#new-thread-form"), {
    withSubject: true,
    submit: async ({ subject, body, proof }) => {
      const { threadId } = await api.createThread({ boardId: board.id, subject, body, proof });
      location.href = `./thread.html?t=${encodeURIComponent(threadId)}`;
    },
  });
}

/* ------------------------------------------------------------------ *
 * Thread view
 * ------------------------------------------------------------------ */

async function renderThread() {
  const threadId = params.get("t");
  const shell = document.querySelector("#thread-shell");
  const data = threadId ? await api.getThread(threadId) : null;

  if (!data) {
    shell.innerHTML = `<p class="empty">That thread does not exist, or it was removed.</p>`;
    document.querySelector("#reply-section")?.remove();
    return;
  }

  const { thread } = data;
  document.title = `${thread.subject} — NoCoords`;
  document.querySelector("#thread-subject").textContent = thread.subject;
  const info = document.querySelector("#thread-info");
  if (info) {
    const replies = data.posts.length - 1;
    info.textContent = `${replies} repl${replies === 1 ? "y" : "ies"} · started ${timeAgo(thread.createdAt)}`;
  }
  document.querySelector("#thread-board").innerHTML =
    `<a href="./board.html?b=${encodeURIComponent(thread.boardId)}">/${escapeHtml(thread.boardId)}/</a>`;

  const postList = document.querySelector("#post-list");
  const yourId = await posterIdFor(thread.id);
  document.querySelector("#your-id").textContent = yourId;
  const yourName = document.querySelector("#your-name");
  if (yourName) yourName.textContent = handleFor(yourId);

  async function paint() {
    const current = await api.getThread(thread.id);
    const opId = current.posts[0]?.posterId;

    postList.innerHTML = "";
    current.posts.forEach((post, index) => postList.append(postNode(post, index === 0, opId, paint)));
  }

  await paint();

  const list = document.querySelector("#post-list");
  list.addEventListener("click", (event) => {
    const ref = event.target.closest("a.post-ref");
    if (ref) {
      const target = document.querySelector(ref.getAttribute("href"));
      if (target) {
        event.preventDefault();
        target.scrollIntoView({ block: "center" });
        target.classList.remove("post-flash");
        void target.offsetWidth;
        target.classList.add("post-flash");
      }
      return;
    }

    const no = event.target.closest("a.post-no");
    if (no) {
      event.preventDefault();
      const textarea = document.querySelector("#reply-form [name=body]");
      const selection = String(window.getSelection() ?? "").trim();
      let quote = `>>${no.dataset.post}\n`;
      if (selection) {
        quote += selection.split("\n").map((line) => `>${line}`).join("\n") + "\n";
      }
      textarea.value = textarea.value ? `${textarea.value.replace(/\n?$/, "\n")}${quote}` : quote;
      textarea.dispatchEvent(new Event("input"));
      textarea.focus();
    }
  });

  initComposer(document.querySelector("#reply-form"), {
    withSubject: false,
    draftKey: `nocoords.draft.${thread.id}`,
    submit: async ({ body, proof }) => {
      await api.createPost({ threadId: thread.id, body, proof });
      await paint();
      setStatus(document.querySelector("#reply-form .status"), "Posted.");
      document.querySelector("#reply-form [type=submit]").disabled = false;
    },
  });

  initAdminBar(paint);
}

function postNode(post, isOp, opId, refresh) {
  const classes = ["post"];
  if (isOp) classes.push("post-op");
  if (post.removed) classes.push("post-removed");

  const isFromOp = post.posterId === opId;
  const idClass = isFromOp ? "poster-id poster-id-op" : "poster-id";

  const node = el(`
    <article class="${classes.join(" ")}" id="post-${escapeHtml(post.id)}">
      <div class="post-meta">
        <span class="poster-name">${escapeHtml(handleFor(post.posterId))}</span>
        ${isFromOp ? '<span class="op-tag">OP</span>' : ""}
        <span title="${new Date(post.createdAt).toLocaleString()}">${timeAgo(post.createdAt)}</span>
        <span class="${idClass}" hidden>${escapeHtml(post.posterId)}</span>
        <a class="post-no" href="#post-${escapeHtml(post.id)}" data-post="${escapeHtml(post.id)}" title="Quote this post">#${escapeHtml(post.id)}</a>
      </div>
      <div class="post-body"></div>
    </article>
  `);

  // CSSOM, not a style attribute: the pages' CSP (style-src 'self') blocks
  // inline style markup but allows script-set styles.
  node.querySelector(".poster-name").style.color = handleColor(post.posterId);

  const bodyNode = node.querySelector(".post-body");

  const book = post.removed || isSealed(post.body) ? null : parseBook(post.body);

  if (post.removed) {
    bodyNode.textContent = "[removed by operator]";
  } else if (isSealed(post.body)) {
    bodyNode.remove();
    node.append(sealedNode(post.body));
  } else if (book) {
    bodyNode.remove();
    node.append(bookNode(book));
  } else {
    const moj = parseMojangles(post.body);
    if (moj !== null) {
      bodyNode.classList.add("mojangles");
      bodyNode.innerHTML = renderBody(moj);
    } else {
      bodyNode.innerHTML = renderBody(post.body);
    }
  }

  if (admin.active && !post.removed) {
    const actions = el(`<div class="post-actions"></div>`);
    const button = el(`<button class="button button-small button-danger" type="button">Remove</button>`);

    button.addEventListener("click", async () => {
      if (!confirm(`Remove post #${post.id}? This cannot be undone.`)) {
        return;
      }
      button.disabled = true;
      try {
        await api.removePost(post.id, admin.key);
        await refresh();
      } catch (error) {
        button.disabled = false;
        alert(error.message);
      }
    });

    actions.append(button);
    node.append(actions);
  }

  return node;
}

function sealedNode(body) {
  const node = el(`
    <div class="sealed">
      <span class="sealed-label">🔒 Private post — needs the passphrase</span>
      <form class="sealed-form">
        <label class="visually-hidden" for="unseal-${Math.random().toString(36).slice(2)}">Passphrase</label>
        <input type="password" name="passphrase" placeholder="Passphrase" autocomplete="off">
        <button class="button button-small" type="submit">Unseal</button>
      </form>
      <p class="sealed-error" hidden></p>
    </div>
  `);

  const form = node.querySelector("form");
  const error = node.querySelector(".sealed-error");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const passphrase = form.querySelector("[name=passphrase]").value;
    error.hidden = true;

    try {
      const plaintext = await unseal(body, passphrase);
      const revealed = el(`<div class="post-body"></div>`);
      revealed.innerHTML = renderBody(plaintext);
      node.replaceWith(revealed);
    } catch {
      error.textContent = "That passphrase didn't work.";
      error.hidden = false;
    }
  });

  return node;
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function showMockNotice() {
  if (!isMock) return;
  const notice = document.querySelector("#mock-notice");
  if (notice) notice.hidden = false;
}

const pages = {
  index: renderBoardIndex,
  board: renderBoard,
  thread: renderThread,
};

const page = document.body.dataset.page;

showMockNotice();
ensureObfuscation();
document.querySelector("#pow-difficulty")?.replaceChildren(String(POW_DIFFICULTY));

// Texture probe resolves before the page paints, so overrides apply to the
// first render too. It is a no-op unless the local opt-in flag is set.
loadBookTextures().then(() => pages[page]?.()).catch((error) => {
  console.error(error);
  const shell = document.querySelector("main");
  if (shell) {
    shell.prepend(el(`<p class="notice notice-warn">Could not load the board: ${escapeHtml(error.message)}</p>`));
  }
});

if (page !== "thread") {
  initAdminBar();
}
