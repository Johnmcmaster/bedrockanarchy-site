import { chromium } from "playwright";

/*
 * End-to-end UI tests. Requires playwright and a local server:
 *
 *   npx playwright install chromium
 *   python3 -m http.server 8099        # from the repo root
 *   node forum/test/ui.test.mjs
 *
 * Override the defaults with FORUM_BASE and CHROME_PATH if needed.
 */
const BASE = process.env.FORUM_BASE ?? "http://localhost:8099/forum";
const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}
);
const page = await browser.newPage();

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

// Fail loudly if anything tries to leave the origin.
page.on("request", (r) => {
  const url = new URL(r.url());
  if (url.host !== new URL(BASE).host) errors.push(`EXTERNAL REQUEST: ${r.url()}`);
});

function ok(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) process.exitCode = 1;
}

// ---- index ----
await page.goto(`${BASE}/index.html`);
await page.waitForSelector(".board-card");
ok("index renders 5 boards", (await page.locator(".board-card").count()) === 5);
ok("seeded poster ids are 6 hex", await page.evaluate(() => JSON.parse(localStorage.getItem("nocoords.mock.v6")).posts.every(p => /^[0-9a-f]{6}$/.test(p.posterId))));
ok("index shows seeded recent threads", (await page.locator("#recent-threads .thread-row").count()) > 0);
ok("preview notice visible", await page.locator("#mock-notice").isVisible());

// ---- board + new thread with proof of work ----
await page.goto(`${BASE}/board.html?b=anarchy`);
await page.waitForSelector(".thread-row");
const beforeCount = await page.locator("#thread-list .thread-row").count();
ok("board name rendered", (await page.locator("#board-name").textContent()).includes("/anarchy/"));

ok("passphrase field hidden until sealed is checked", !(await page.locator("#pass-field").isVisible()));
ok("mock notice is one line, not split", (await page.locator("#mock-notice").boundingBox()).height < 70);
await page.fill("#subject", "Test thread from automation");
await page.fill("#body", "Body of the automated test thread. https://example.com/link");
const t0 = Date.now();
await page.click("#new-thread-form [type=submit]");
await page.waitForURL(/thread\.html/, { timeout: 30000 });
console.log(`      (post incl. proof-of-work took ${Date.now() - t0}ms)`);
ok("new thread redirects to thread page", page.url().includes("thread.html?t="));
await page.waitForSelector(".post");
ok("OP rendered", (await page.locator(".post").count()) === 1);
ok("subject rendered", (await page.locator("#thread-subject").textContent()) === "Test thread from automation");
ok("link was linkified", (await page.locator(".post-body a").count()) === 1);
ok("link carries no-referrer", (await page.locator(".post-body a").getAttribute("referrerpolicy")) === "no-referrer");
const yourId = await page.locator("#your-id").textContent();
ok("poster id generated (6 hex)", /^[0-9a-f]{6}$/.test(yourId));
ok("OP badge shown on first post", (await page.locator(".poster-id-op").count()) === 1);

const threadUrl = page.url();

// ---- reply ----
await page.fill("#reply-form [name=body]", "A plain reply.");
await page.click("#reply-form [type=submit]");
await page.waitForFunction(() => document.querySelectorAll(".post").length === 2, null, { timeout: 30000 });
ok("reply appended", (await page.locator(".post").count()) === 2);

// ---- refs, quoting, drafts ----
const opNo = await page.locator(".post-no").first().getAttribute("data-post");
await page.fill("#reply-form [name=body]", `>>${opNo}\n>quoted line\nagree with this`);
await page.click("#reply-form [type=submit]");
await page.waitForFunction(() => document.querySelectorAll(".post").length === 3, null, { timeout: 30000 });
ok(">>ref renders as link", (await page.locator(".post-ref").count()) === 1);
ok("greentext renders", (await page.locator(".post-body .greentext").count()) === 1);
ok("ref links to the OP", (await page.locator(".post-ref").getAttribute("href")) === `#post-${opNo}`);
await page.locator(".post-no").last().click();
const quoted = await page.inputValue("#reply-form [name=body]");
ok("clicking post number quotes it", quoted.startsWith(">>"));
await page.fill("#reply-form [name=body]", "draft to survive reload");
await page.reload();
await page.waitForSelector(".post");
ok("draft survives reload", (await page.inputValue("#reply-form [name=body]")) === "draft to survive reload");
await page.fill("#reply-form [name=body]", "");

// ---- sealed post round trip ----
await page.click("#reply-form .advanced summary");
await page.check("#reply-form [name=sealed]");
ok("passphrase field revealed", await page.locator("#pass-field").isVisible());
await page.fill("#reply-form [name=body]", "x=1234 z=-5678 stash under the spruce");
await page.fill("#reply-form [name=passphrase]", "correct horse battery staple");
await page.click("#reply-form [type=submit]");
await page.waitForFunction(() => document.querySelectorAll(".post").length === 4, null, { timeout: 30000 });
await page.waitForSelector(".sealed");
ok("sealed post renders locked", (await page.locator(".sealed").count()) === 1);
const rawSealed = await page.evaluate(() => {
  const store = JSON.parse(localStorage.getItem("nocoords.mock.v6"));
  return store.posts[store.posts.length - 1].body;
});
ok("ciphertext stored, not plaintext", rawSealed.startsWith("nc1.") && !rawSealed.includes("stash"));

// wrong passphrase
await page.fill(".sealed input[name=passphrase]", "wrong");
await page.click(".sealed button[type=submit]");
await page.waitForSelector(".sealed-error:not([hidden])");
ok("wrong passphrase rejected", (await page.locator(".sealed-error").textContent()).includes("passphrase"));

// right passphrase
await page.fill(".sealed input[name=passphrase]", "correct horse battery staple");
await page.click(".sealed button[type=submit]");
await page.waitForFunction(() => !document.querySelector(".sealed"), null, { timeout: 10000 });
ok("correct passphrase unseals", (await page.locator(".post-body").last().textContent()).includes("x=1234"));

// ---- admin removal ----
await page.goto(`${threadUrl}#admin`);
await page.waitForSelector(".post");
await page.waitForSelector("#admin-bar.is-active", { timeout: 5000 });
ok("admin bar reveals on #admin without reload", await page.locator("#admin-bar").isVisible());
await page.fill("#admin-key", "test-operator-key");
await page.click("#admin-apply");
await page.waitForSelector(".post-actions button");
ok("remove buttons appear when unlocked", (await page.locator(".post-actions button").count()) === 4);

page.on("dialog", (d) => d.accept());
await page.locator(".post-actions button").last().click();
await page.waitForSelector(".post-removed", { timeout: 10000 });
ok("post removed", (await page.locator(".post-removed").count()) === 1);
ok("removed body scrubbed", (await page.locator(".post-removed .post-body").textContent()).includes("[removed by operator]"));
const scrubbed = await page.evaluate(() => {
  const store = JSON.parse(localStorage.getItem("nocoords.mock.v6"));
  return store.posts[store.posts.length - 1];
});
ok("removed body cleared in storage", scrubbed.removed === true && scrubbed.body === "");

await page.click("#admin-clear");
await page.reload();
await page.waitForSelector(".post");
ok("locking hides remove buttons", (await page.locator(".post-actions button").count()) === 0);

// ---- XSS check ----
await page.goto(`${BASE}/board.html?b=b`);
await page.fill("#subject", "<img src=x onerror=alert(1)>");
await page.fill("#body", "<script>window.__pwned=1<\/script> & \"quotes\" 'here'");
await page.click("#new-thread-form [type=submit]");
await page.waitForURL(/thread\.html/, { timeout: 30000 });
await page.waitForSelector(".post");
ok("no script injection", (await page.evaluate(() => window.__pwned)) === undefined);
ok("no injected img element", (await page.locator(".post img, #thread-subject img").count()) === 0);
ok("markup shown as text", (await page.locator(".post-body").first().textContent()).includes("<script>"));

// ---- /book posts (two-page spread) ----
await page.goto(`${BASE}/board.html?b=tech`);
await page.waitForSelector("#new-thread-form");
await page.fill("#subject", "Book test thread");
await page.fill("#body", "/book Field Guide\nAlpha page text\n---\n>green line\nBeta page text\n---\nGamma page text");
await page.click("#new-thread-form [type=submit]");
await page.waitForURL(/thread\.html/, { timeout: 30000 });
await page.waitForSelector(".book-inline");
ok("book icon renders for /book post", (await page.locator(".book-inline-title").textContent()) === "Field Guide");
ok("page count shown", (await page.locator(".book-inline-pages").textContent()) === "3 pages");
await page.click(".book-inline");
await page.waitForSelector(".book-overlay");
ok("spread opens on pages 1-2", (await page.locator(".book-page-num").first().textContent()) === "Page 1 of 3"
  && (await page.locator(".book-page-num").nth(1).textContent()) === "Page 2 of 3");
ok("prev arrow hidden on first spread", !(await page.locator(".book-arrow-prev").isVisible()));
ok("greentext works inside book", (await page.locator(".book-page-text .greentext").count()) === 1);
await page.click(".book-arrow-next");
ok("next flips to page 3", (await page.locator(".book-page-num").first().textContent()) === "Page 3 of 3");
ok("right page empty past the end", (await page.locator(".book-page-num").nth(1).textContent()) === "");
ok("next arrow hidden on last spread", !(await page.locator(".book-arrow-next").isVisible()));
await page.click(".book-done");
await page.waitForFunction(() => !document.querySelector(".book-overlay"));
ok("Done closes the book", true);
await page.evaluate(() => {
  const store = JSON.parse(localStorage.getItem("nocoords.mock.v6"));
  const pages = Array.from({ length: 60 }, (_, i) => `page ${i + 1}`).join("\n---\n");
  store.posts[store.posts.length - 1].body = `/book Overflow\n${pages}`;
  localStorage.setItem("nocoords.mock.v6", JSON.stringify(store));
});
await page.reload();
await page.waitForSelector(".book-inline");
ok("page cap enforced at 50", (await page.locator(".book-inline-pages").textContent()) === "50 pages");

// ---- command palette + /mojangles + formatting codes ----
await page.goto(`${BASE}/board.html?b=b`);
await page.waitForSelector("#new-thread-form");
await page.fill("#body", "/");
await page.waitForSelector(".cmd-palette:not([hidden])");
ok("command palette opens on /", (await page.locator(".cmd-item").count()) === 2);
await page.fill("#body", "/mjl");
ok("fuzzy match narrows to mojangles", (await page.locator(".cmd-item").count()) === 1
  && (await page.locator(".cmd-name").textContent()).includes("m"));
await page.focus("#body");
await page.keyboard.press("Enter");
ok("Enter picks the command", (await page.inputValue("#body")) === "/mojangles ");
ok("palette closes after pick", await page.locator(".cmd-palette").isHidden());
await page.fill("#subject", "Format test");
await page.fill("#body", "/mojangles \u00a74red words\u00a7r and \u00a72\u00a7lbold green\u00a7r plain");
await page.click("#new-thread-form [type=submit]");
await page.waitForURL(/thread\.html/, { timeout: 30000 });
await page.waitForSelector(".post-body.mojangles");
ok("mojangles post uses pixel font class", true);
const fmtText = await page.locator(".post-body").first().textContent();
ok("command stripped from rendered body", !fmtText.includes("/mojangles"));
ok("\u00a7 codes hidden in rendered text", !fmtText.includes("\u00a7"));
ok("color span rendered", (await page.locator(".post-body .mc-4").count()) === 1);
ok("bold+color combo rendered", (await page.locator(".post-body .mc-2.mc-l").count()) === 1);

// ---- in-box live formatting editor ----
await page.goto(`${BASE}/board.html?b=b`);
await page.waitForSelector("#new-thread-form");
const wrapSel = "#new-thread-form .editor-wrap";
ok("editor idle for plain text", !(await page.locator(`${wrapSel}.editor-live`).count()));
await page.fill("#body", "\u00a74red words \u00a72\u00a7lgo");
ok("editor activates on \u00a7 codes", (await page.locator(`${wrapSel}.editor-live`).count()) === 1);
ok("backdrop colors text live", (await page.locator(`${wrapSel} .editor-backdrop .mc-4:not(.e-code)`).textContent()) === "red words ");
ok("codes stay visible but dimmed", (await page.locator(`${wrapSel} .editor-backdrop .e-code`).count()) === 3);
ok("code token wears its own color", (await page.locator(`${wrapSel} .editor-backdrop .e-code.mc-4`).count()) === 1);
ok("later code token carries combined state", (await page.locator(`${wrapSel} .editor-backdrop .e-code.mc-2.e-l`).count()) === 1);
ok("faux bold applied", (await page.locator(`${wrapSel} .editor-backdrop .mc-2.e-l:not(.e-code)`).count()) === 1);
await page.fill("#body", "/mojangles hello");
ok("mojangles switches box font", (await page.locator(`${wrapSel}.mojangles-mode`).count()) === 1);
const fontNow = await page.evaluate(() => getComputedStyle(document.querySelector("#new-thread-form .editor-input")).fontFamily);
ok("textarea itself uses Monocraft", fontNow.includes("Monocraft"));
await page.fill("#body", "back to plain");
ok("editor deactivates cleanly", !(await page.locator(`${wrapSel}.editor-live`).count()));

// ---- missing thread ----
await page.goto(`${BASE}/thread.html?t=doesnotexist`);
await page.waitForSelector(".empty");
ok("missing thread handled", (await page.locator(".empty").textContent()).includes("does not exist"));

// ---- mobile ----
await page.setViewportSize({ width: 375, height: 720 });
await page.goto(`${BASE}/index.html`);
await page.waitForSelector(".board-card");
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok("no horizontal overflow at 375px", overflow <= 0);

console.log(errors.length ? `\nCONSOLE ERRORS:\n${errors.join("\n")}` : "\nNo console errors, no external requests.");
if (errors.length) process.exitCode = 1;

await browser.close();
