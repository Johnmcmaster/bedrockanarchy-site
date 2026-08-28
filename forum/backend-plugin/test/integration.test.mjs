/* Integration test: the real front-end pages (BACKEND="http") against the
 * plugin backend running standalone on :8321.
 *
 * Setup: copy forum/ somewhere disposable, then in the copy set
 * BACKEND="http" and API_BASE="http://127.0.0.1:8321/api" in api.js, and add
 * http://127.0.0.1:8321 to connect-src in the three pages' CSP meta tags.
 * Serve the copy's parent dir on :8098, run the backend on :8321 with
 * admin-key=test-admin-key-123, then:  node integration.test.mjs
 */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8098/forum";
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
let passed = 0;
let failed = 0;

function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name} ${detail}`);
  }
}

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage();
const offOrigin = [];
page.on("request", (r) => {
  const url = r.url();
  if (!url.startsWith("http://127.0.0.1:8098") && !url.startsWith("http://127.0.0.1:8321")) {
    offOrigin.push(url);
  }
});
const consoleErrors = [];
page.on("console", (m) => {
  // Navigating away mid-fetch logs a benign "Failed to fetch" abort; ignore those.
  if (m.type() === "error" && !m.text().includes("Failed to fetch")) consoleErrors.push(m.text());
});

// Home shows live board counts from the server
await page.goto(`${BASE}/index.html`);
await page.waitForSelector("#board-grid .board-card");
const boardCount = await page.locator("#board-grid .board-card").count();
check("home lists boards from server", boardCount >= 5, String(boardCount));

// Start a thread through the UI (solves real PoW in the browser)
await page.goto(`${BASE}/board.html?b=tech`);
await page.waitForSelector("#new-thread-form[data-ready]");
await page.fill("#subject", "Integration test thread");
await page.fill("#body", "posted by the browser against the plugin backend §a§lgreen§r end");
await page.click("#new-thread-form button[type=submit]");
await page.waitForURL(/thread\.html\?t=/, { timeout: 45000 });
check("thread created and redirected", true);

// The server-derived `you` must match the OP's posterId on the post itself
await page.waitForSelector(".post");
const yourId = await page.locator("#your-id").textContent();
const opId = await page.locator(".poster-id-op").first().textContent();
check("your-id comes from server and matches OP", yourId === opId && /^[0-9a-f]{6}$/.test(yourId), `${yourId} vs ${opId}`);

// Formatting survived the round trip
check("formatting renders from server data", (await page.locator(".post-body .mc-a").count()) > 0);

// Reply through the UI
await page.waitForSelector("#reply-form[data-ready]");
await page.fill("#body", ">>reply through http backend");
await page.click("#reply-form button[type=submit], #new-thread-form button[type=submit]");
await page.waitForFunction(() => document.querySelectorAll(".post").length >= 2, null, { timeout: 45000 });
const posts = await page.locator(".post").count();
check("reply posted", posts === 2, String(posts));
const replyPoster = await page.locator(".post .poster-id").nth(1).textContent();
check("same tab gets same server ID in thread", replyPoster === yourId, `${replyPoster} vs ${yourId}`);

// Board listing shows the thread with server-side excerpt (codes stripped)
const threadUrl = page.url();
await page.goto(`${BASE}/board.html?b=tech`);
await page.waitForSelector(".thread-list .thread-row");
const listing = await page.locator(".thread-list").textContent();
check("board shows thread", listing.includes("Integration test thread"), listing.slice(0, 120));
check("excerpt has codes stripped", listing.includes("green") && !listing.includes("§a"));

// Admin removal through the UI
page.on("dialog", (d) => d.accept());
await page.goto(threadUrl + "#admin");
await page.waitForSelector("#admin-key", { timeout: 5000 });
await page.fill("#admin-key", "test-admin-key-123");
await page.click("#admin-apply");
await page.waitForSelector(".post .button-danger", { timeout: 10000 });
await page.locator(".post .button-danger").last().click();
await page.waitForFunction(
  () => [...document.querySelectorAll(".post")].some((p) => p.textContent.includes("[removed]") || p.className.includes("removed")),
  null,
  { timeout: 10000 }
);
check("admin removal through UI", true);

// No cookies were ever set, nothing left the two local origins
const cookies = await page.context().cookies();
check("no cookies anywhere", cookies.length === 0, JSON.stringify(cookies));
check("no off-origin requests", offOrigin.length === 0, offOrigin.join(", "));
check("no console errors", consoleErrors.length === 0, consoleErrors.join(" | "));

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
