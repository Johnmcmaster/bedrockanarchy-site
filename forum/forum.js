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

function greentext(escaped) {
  return escaped
    .split("\n")
    .map((line) => (/^&gt;(?!&gt;)/.test(line) ? `<span class="greentext">${line}</span>` : line))
    .join("\n");
}

function renderBody(body) {
  return greentext(postRefs(linkify(escapeHtml(body))));
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
      if (saved) bodyInput.value = saved;
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

  if (post.removed) {
    bodyNode.textContent = "[removed by operator]";
  } else if (isSealed(post.body)) {
    bodyNode.remove();
    node.append(sealedNode(post.body));
  } else {
    bodyNode.innerHTML = renderBody(post.body);
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
document.querySelector("#pow-difficulty")?.replaceChildren(String(POW_DIFFICULTY));

pages[page]?.().catch((error) => {
  console.error(error);
  const shell = document.querySelector("main");
  if (shell) {
    shell.prepend(el(`<p class="notice notice-warn">Could not load the board: ${escapeHtml(error.message)}</p>`));
  }
});

if (page !== "thread") {
  initAdminBar();
}
