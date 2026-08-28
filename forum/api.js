/*
 * Data layer.
 *
 * The forum UI talks only to the `api` object exported here, so swapping the
 * mock for a real server is a one-line change plus filling in HttpBackend.
 * Set BACKEND to "http" and API_BASE to your server once it exists; nothing in
 * the UI code needs to change.
 *
 * The mock keeps everything in this browser's localStorage. It is for building
 * and demoing the interface. It is not a forum: nothing you post is visible to
 * anyone else, because there is no server.
 */

import { solve as solvePow, verify as verifyPow } from "./pow.js";

/*
 * On nocoords.org the backend plugin serves these very pages, so the real API
 * lives at the same origin. Anywhere else (local dev, tests, previews) the
 * mock keeps working. localStorage "nocoords.backend" forces either mode.
 */
const BACKEND = (() => {
  try {
    const forced = localStorage.getItem("nocoords.backend");
    if (forced === "mock" || forced === "http") return forced;
  } catch { /* storage unavailable */ }
  return location.hostname.endsWith("nocoords.org") ? "http" : "mock";
})(); // "mock" | "http"
const API_BASE = "/api";

export const POW_DIFFICULTY = 16;

const STORE_KEY = "nocoords.mock.v6";
const SESSION_SECRET_KEY = "nocoords.session";

/* ------------------------------------------------------------------ *
 * Anonymous per-thread poster IDs
 * ------------------------------------------------------------------ */

/*
 * A poster ID lets people follow who is replying to whom inside one thread,
 * without any account or persistent identity. It is derived from a random
 * secret generated per browser tab and thrown away when the tab closes, so the
 * same person gets a different ID in every thread and a different ID tomorrow.
 *
 * It is a readability aid, not an identity claim. Nothing verifies it.
 */
function sessionSecret() {
  let secret = sessionStorage.getItem(SESSION_SECRET_KEY);
  if (!secret) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    secret = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    sessionStorage.setItem(SESSION_SECRET_KEY, secret);
  }
  return secret;
}

export async function posterIdFor(threadId) {
  const data = new TextEncoder().encode(`${sessionSecret()}:${threadId}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(hash.slice(0, 3), (b) => b.toString(16).padStart(2, "0")).join("");
}

/* Mock-only voter tag, same shape as the server's rotating-HMAC one. */
async function voterTagFor(postId) {
  return posterIdFor(`vote|${postId}`);
}

function voteCounts(post) {
  const votes = post.votes ?? {};
  let ups = 0;
  let downs = 0;
  for (const value of Object.values(votes)) {
    if (value > 0) ups += 1;
    else if (value < 0) downs += 1;
  }
  return { ups, downs };
}

/* ------------------------------------------------------------------ *
 * Mock backend
 * ------------------------------------------------------------------ */

const BOARDS = [
  { id: "b", name: "Random", description: "Anything at all. The default board." },
  { id: "servers", name: "Servers", description: "Any anarchy server. Finds, reviews, drama, advertise yours." },
  { id: "anarchy", name: "Anarchy", description: "Griefing, raiding, PvP, base war stories." },
  { id: "tech", name: "Tech", description: "Redstone, farms, exploits, automation." },
  { id: "meta", name: "Meta", description: "About this forum itself." },
];

const SEED_THREADS = [
  {
    boardId: "anarchy",
    subject: "Spawn is completely stripped again",
    body:
      "Went out 2k in every direction from spawn and there is nothing left. No trees, no sand, "
      + "every chest already popped. Anyone found a stash that has not been hit yet?",
    replies: [
      "That is what spawn is. Walk further. 10k minimum before you even think about a base.",
      "Highway is the answer. Get on the nether roof and go until you stop seeing builds.",
    ],
  },
  {
    boardId: "meta",
    subject: "How this place works",
    body:
      "No accounts. No email. No usernames. You type, you post, that is the whole flow.\n\n"
      + "Nothing is uploaded except text, so there are no images to leak metadata.\n\n"
      + "Posts are not moderated for opinion. The only thing that gets removed is content that "
      + "would get the domain seized.",
    replies: [
      "Refreshing to see a board that just says what the rule actually is instead of pretending there is none.",
      "\u00a77Formatting works here: \u00a7c\u00a7lred\u00a7r\u00a77, \u00a7agreen\u00a7r\u00a77, even \u00a7kmagic\u00a7r\u00a77. Type \u00a76/\u00a77 in the reply box to see commands like \u00a76/mojangles\u00a77 and \u00a76/book\u00a77.",
    ],
  },
  {
    boardId: "tech",
    subject: "Bedrock iron farm rates post-update",
    body: "Anyone benchmarked a standard iron farm since the update? Getting noticeably worse rates than before.",
    replies: [
      ">>%OP%\nSame here. Roughly 20% down on my counts. Villager pathing changed, rebuild the beds one block higher.",
    ],
  },
  {
    boardId: "servers",
    subject: "Which anarchy servers are actually alive right now",
    body:
      "Looking for servers with real player counts, not 3 AFK bots on a listing site. "
      + "Bedrock or Java, doesn't matter. What are you actually playing on?",
    replies: [
      "bedrockanarchy.org if you're on Bedrock. Small but real people.",
      ">>%OP%\n>real player counts\nEvery listing site number is inflated. Join at different times of day and count for yourself.",
    ],
  },
  {
    boardId: "anarchy",
    subject: "Best grief you ever pulled off",
    body: "Not the biggest. The best. Cleverness counts more than TNT count.",
    replies: [
      "Joined a group, spent two weeks helping them build. They gave me trust and lava access in that order.",
      ">>%OP%\nReplaced every chest in a base with trapped chests wired to nothing. They tore their own base apart looking for the wiring.",
    ],
  },
  {
    boardId: "anarchy",
    subject: "I wrote down how our base fell",
    body:
      "/book The Fall of Deepholm\n"
      + "We held Deepholm for four months. This is how it ended, written so the next group "
      + "makes different mistakes.\n"
      + "---\n"
      + "Rule one: we recruited from chat. That is how he got in. Friendly, helpful, always "
      + "online at odd hours. He fixed the farms nobody wanted to fix.\n"
      + "---\n"
      + ">be us\n>four months of peace\n>wake up to lava in the storage hall\n\n"
      + "He never said a word. Just left one sign: thanks for the tour.\n"
      + "---\n"
      + "If you take one thing from this book: the base does not fall to TNT. It falls to "
      + "trust. Build smaller. Tell fewer people. And check who fixes your farms.",
    replies: [
      "Genuinely good read. The sign detail is brutal.",
    ],
  },
  {
    boardId: "b",
    subject: "What are you all listening to while you dig",
    body: "600 blocks of tunnel to go. Need something.\n\n>digging straight down like it owes me money",
    replies: ["Nothing. Sound on, you want to hear the creeper."],
  },
];

function nowMinus(minutes) {
  return Date.now() - minutes * 60000;
}

function randomPosterId() {
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function freshStore() {
  const store = { threads: [], posts: [], seq: 1 };
  let offset = 1300;

  SEED_THREADS.forEach((seed) => {
    const threadId = `t${store.seq++}`;
    const createdAt = nowMinus(offset);
    let bumpedAt = createdAt;

    store.threads.push({
      id: threadId,
      boardId: seed.boardId,
      subject: seed.subject,
      createdAt,
      bumpedAt,
    });

    store.posts.push({
      id: `p${store.seq++}`,
      threadId,
      posterId: randomPosterId(),
      body: seed.body,
      createdAt,
      removed: false,
    });

    const opPostId = store.posts[store.posts.length - 1].id;
    seed.replies.forEach((reply, index) => {
      bumpedAt = createdAt + (index + 1) * 21 * 60000;
      store.posts.push({
        id: `p${store.seq++}`,
        threadId,
        posterId: randomPosterId(),
        body: reply.replace(/%OP%/g, opPostId),
        createdAt: bumpedAt,
        removed: false,
      });
    });

    const thread = store.threads[store.threads.length - 1];
    thread.bumpedAt = bumpedAt;
    offset -= 180;
  });

  return store;
}

function readStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // Corrupt or unavailable storage: fall through and reseed.
  }

  const store = freshStore();
  writeStore(store);
  return store;
}

function writeStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Private browsing with storage denied. The UI still works for this pageview.
  }
}

function excerptOf(body) {
  if (body.startsWith("nc1.")) {
    return "[sealed post]";
  }
  if (/^\/book(\s|$)/.test(body)) {
    const title = body.split("\n")[0].replace(/^\/book\s*/, "").trim() || "Untitled";
    return `[book] ${title}`;
  }
  if (/^\/mojangles(\s|$)/.test(body)) {
    body = body.replace(/^\/mojangles\s*/, "");
  }
  const flat = body.replace(/\u00a7[0-9a-fk-or]/gi, "").replace(/\s+/g, " ").trim();
  return flat.length > 180 ? `${flat.slice(0, 180)}…` : flat;
}

const mockBackend = {
  async listBoards() {
    const store = readStore();
    return BOARDS.map((board) => ({
      ...board,
      threadCount: store.threads.filter((thread) => thread.boardId === board.id).length,
    }));
  },

  async listThreads(boardId) {
    const store = readStore();
    return store.threads
      .filter((thread) => !boardId || thread.boardId === boardId)
      .sort((a, b) => b.bumpedAt - a.bumpedAt)
      .map((thread) => {
        const posts = store.posts.filter((post) => post.threadId === thread.id);
        const op = posts[0];
        const counts = op ? voteCounts(op) : { ups: 0, downs: 0 };
        return {
          ...thread,
          replyCount: Math.max(posts.length - 1, 0),
          excerpt: op && !op.removed ? excerptOf(op.body) : "[removed]",
          score: counts.ups - counts.downs,
        };
      });
  },

  async getThread(threadId) {
    const store = readStore();
    const thread = store.threads.find((item) => item.id === threadId);
    if (!thread) {
      return null;
    }
    const posts = await Promise.all(
      store.posts
        .filter((post) => post.threadId === threadId)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(async (post) => ({
          ...post,
          ...voteCounts(post),
          yourVote: (post.votes ?? {})[await voterTagFor(post.id)] ?? 0,
        }))
    );
    return { thread, posts };
  },

  async vote(postId, value) {
    const store = readStore();
    const post = store.posts.find((item) => item.id === postId);
    if (!post || post.removed) {
      throw new Error("Post not found.");
    }
    post.votes = post.votes ?? {};
    const tag = await voterTagFor(postId);
    if (value === 0) delete post.votes[tag];
    else post.votes[tag] = value > 0 ? 1 : -1;
    writeStore(store);
    return { ...voteCounts(post), yourVote: post.votes[tag] ?? 0 };
  },

  async challenge() {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    return {
      seed: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""),
      difficulty: POW_DIFFICULTY,
    };
  },

  async createThread({ boardId, subject, body, proof }) {
    await assertProof(proof);
    const store = readStore();
    const threadId = `t${store.seq++}`;
    const createdAt = Date.now();

    store.threads.push({ id: threadId, boardId, subject, createdAt, bumpedAt: createdAt });
    store.posts.push({
      id: `p${store.seq++}`,
      threadId,
      posterId: await posterIdFor(threadId),
      body,
      createdAt,
      removed: false,
    });

    writeStore(store);
    return { threadId };
  },

  async createPost({ threadId, body, proof }) {
    await assertProof(proof);
    const store = readStore();
    const thread = store.threads.find((item) => item.id === threadId);
    if (!thread) {
      throw new Error("Thread not found.");
    }

    const createdAt = Date.now();
    const postId = `p${store.seq++}`;
    store.posts.push({
      id: postId,
      threadId,
      posterId: await posterIdFor(threadId),
      body,
      createdAt,
      removed: false,
    });
    thread.bumpedAt = createdAt;

    writeStore(store);
    return { postId };
  },

  async removePost(postId, adminKey) {
    if (!adminKey) {
      throw new Error("Admin key required.");
    }
    const store = readStore();
    const post = store.posts.find((item) => item.id === postId);
    if (!post) {
      throw new Error("Post not found.");
    }
    post.removed = true;
    post.body = "";
    writeStore(store);
    return { removed: true };
  },

  async reset() {
    writeStore(freshStore());
  },
};

async function assertProof(proof) {
  if (!proof || !(await verifyPow(proof.seed, proof.nonce, POW_DIFFICULTY))) {
    throw new Error("Invalid proof of work.");
  }
}

/* ------------------------------------------------------------------ *
 * HTTP backend
 * ------------------------------------------------------------------ */

/*
 * Fill this in against the contract in README.md when the server exists. The
 * shapes it returns are identical to the mock above.
 */
async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "omit", // no cookies, ever
    referrerPolicy: "no-referrer",
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error ?? `Request failed (${response.status}).`);
  }

  return response.status === 204 ? null : response.json();
}

const httpBackend = {
  listBoards: () => request("/boards"),
  listThreads: (boardId) =>
    boardId == null
      ? request("/threads") // all boards, for the home page's recent list
      : request(`/boards/${encodeURIComponent(boardId)}/threads`),
  getThread: (threadId) => request(`/threads/${encodeURIComponent(threadId)}`),
  challenge: () => request("/challenge"),
  createThread: (payload) =>
    request("/threads", { method: "POST", body: JSON.stringify(payload) }),
  createPost: ({ threadId, ...payload }) =>
    request(`/threads/${encodeURIComponent(threadId)}/posts`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  removePost: (postId, adminKey) =>
    request(`/posts/${encodeURIComponent(postId)}`, {
      method: "DELETE",
      headers: { "X-Admin-Key": adminKey },
    }),
  // Vote challenges are much easier than posting ones, so this solves
  // in-line — a blink, even on a phone.
  vote: async (postId, value) => {
    const proof = await solvePow(await request("/challenge?kind=vote"));
    return request(`/posts/${encodeURIComponent(postId)}/vote`, {
      method: "POST",
      body: JSON.stringify({ value, proof }),
    });
  },
  reset: async () => {},
};

export const api = BACKEND === "http" ? httpBackend : mockBackend;
export const isMock = BACKEND === "mock";
