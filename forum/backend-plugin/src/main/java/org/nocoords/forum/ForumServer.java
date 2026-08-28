package org.nocoords.forum;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;

/*
 * The forum API, on the JDK's built-in HTTP server. Implements the contract in
 * forum/README.md exactly, plus two additions the front-end can use when it is
 * talking to a real server instead of the mock:
 *
 *   - POST responses include the server-derived `posterId`
 *   - GET /api/threads/:id includes `you`, the requester's ID in that thread
 *
 * Privacy rules carried here, matching the README:
 *   - No access log of any kind. Nothing about a request is ever written down.
 *   - Client IPs are read once, fed to the poster-ID HMAC, and discarded.
 *   - No cookies, no Set-Cookie, ever.
 *   - Proof of work is verified server-side; seeds are single-use.
 *   - Only JSON text is accepted; there is no multipart handler to attack.
 *   - Error logging never includes request contents or addresses.
 */
public final class ForumServer {

  private static final int MAX_REQUEST_BYTES = 64 * 1024;
  private static final int MAX_BODY_CHARS = 8000;
  private static final int MAX_SUBJECT_CHARS = 120;
  // Votes cost proof of work like everything else, just less of it: cheap
  // enough to feel instant on a phone, expensive enough that mass-voting
  // burns real CPU.
  private static final int VOTE_DIFFICULTY = 12;

  private final ForumConfig config;
  private final Logger logger;
  private final Store store;
  private final Pow pow;
  private final PosterIds posterIds = new PosterIds();
  private HttpServer server;
  private ExecutorService executor;

  public ForumServer(ForumConfig config, Logger logger) throws IOException {
    this.config = config;
    this.logger = logger;
    this.store = new Store(config.dataFile());
    this.pow = new Pow(config.powDifficulty());
  }

  public void start() throws IOException {
    server = HttpServer.create(new InetSocketAddress(config.bind(), config.port()), 0);
    executor = Executors.newFixedThreadPool(4);
    server.setExecutor(executor);
    server.createContext("/", this::dispatch);
    server.start();
  }

  public void stop() {
    if (server != null) {
      server.stop(0);
      server = null;
    }
    if (executor != null) {
      executor.shutdown();
      try {
        executor.awaitTermination(5, TimeUnit.SECONDS);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
      executor = null;
    }
    try {
      store.flush();
    } catch (IOException e) {
      logger.warning("Could not flush forum data on shutdown: " + e.getClass().getSimpleName());
    }
  }

  private void dispatch(HttpExchange exchange) throws IOException {
    try {
      route(exchange);
    } catch (IllegalArgumentException e) {
      // Malformed JSON or bad input that slipped past explicit checks.
      sendError(exchange, 400, "Bad request.");
    } catch (Exception e) {
      // Never include request details in the log line.
      logger.warning("Forum API error: " + e.getClass().getSimpleName());
      sendError(exchange, 500, "Internal error.");
    } finally {
      exchange.close();
    }
  }

  private void route(HttpExchange exchange) throws IOException {
    String method = exchange.getRequestMethod();
    String path = exchange.getRequestURI().getPath();

    if (method.equals("OPTIONS")) {
      preflight(exchange);
      return;
    }

    // Split "/api/boards/b/threads" into ["api", "boards", "b", "threads"].
    String[] parts = path.replaceAll("^/+|/+$", "").split("/");
    if (parts.length < 2 || !parts[0].equals("api")) {
      serveStatic(exchange, path);
      return;
    }

    switch (parts[1]) {
      case "boards" -> {
        if (parts.length == 2 && method.equals("GET")) {
          sendJson(exchange, 200, store.listBoards());
        } else if (parts.length == 4 && parts[3].equals("threads") && method.equals("GET")) {
          sendJson(exchange, 200, store.listThreads(parts[2]));
        } else {
          sendError(exchange, 404, "Not found.");
        }
      }
      case "challenge" -> {
        if (parts.length == 2 && method.equals("GET")) {
          String query = exchange.getRequestURI().getQuery();
          boolean forVote = query != null && query.contains("kind=vote");
          int difficulty = forVote ? Math.min(VOTE_DIFFICULTY, pow.difficulty()) : pow.difficulty();
          String seed = pow.issue(difficulty);
          if (seed == null) {
            sendError(exchange, 429, "Too many outstanding challenges. Try again shortly.");
            return;
          }
          Map<String, Object> out = new LinkedHashMap<>();
          out.put("seed", seed);
          out.put("difficulty", (long) difficulty);
          sendJson(exchange, 200, out);
        } else {
          sendError(exchange, 404, "Not found.");
        }
      }
      case "threads" -> {
        if (parts.length == 2 && method.equals("GET")) {
          // Every board's threads, bump-sorted — the home page's recent list.
          sendJson(exchange, 200, store.listThreads(null));
        } else if (parts.length == 2 && method.equals("POST")) {
          createThread(exchange);
        } else if (parts.length == 3 && method.equals("GET")) {
          getThread(exchange, parts[2]);
        } else if (parts.length == 4 && parts[3].equals("posts") && method.equals("POST")) {
          createPost(exchange, parts[2]);
        } else {
          sendError(exchange, 404, "Not found.");
        }
      }
      case "posts" -> {
        if (parts.length == 3 && method.equals("DELETE")) {
          removePost(exchange, parts[2]);
        } else if (parts.length == 4 && parts[3].equals("vote") && method.equals("POST")) {
          vote(exchange, parts[2]);
        } else {
          sendError(exchange, 404, "Not found.");
        }
      }
      default -> sendError(exchange, 404, "Not found.");
    }
  }

  private void getThread(HttpExchange exchange, String threadId) throws IOException {
    Map<String, Object> out = store.getThread(threadId);
    if (out == null) {
      sendError(exchange, 404, "Thread not found.");
      return;
    }
    // The requester's own ID in this thread, so the composer can show it.
    // The IP goes into the HMAC and nowhere else.
    String ip = clientIp(exchange);
    out.put("you", posterIds.idFor(threadId, ip));
    if (out.get("posts") instanceof List<?> posts) {
      for (Object item : posts) {
        if (item instanceof Map<?, ?> post) {
          @SuppressWarnings("unchecked")
          Map<String, Object> map = (Map<String, Object>) post;
          String postId = (String) map.get("id");
          map.put("yourVote", store.voteOf(postId, voterTag(postId, ip)));
        }
      }
    }
    sendJson(exchange, 200, out);
  }

  /** Per-post voter tag: same rotating HMAC as poster IDs, different scope. */
  private String voterTag(String postId, String ip) {
    return posterIds.idFor("vote|" + postId, ip);
  }

  private void vote(HttpExchange exchange, String postId) throws IOException {
    Map<String, Object> body = readJsonObject(exchange);
    if (body == null) {
      return;
    }
    if (!checkProof(exchange, body, VOTE_DIFFICULTY)) {
      return;
    }
    Object raw = body.get("value");
    long value = raw instanceof Long l ? l : raw instanceof Double d ? (long) (double) d : 99;
    if (value != 1 && value != -1 && value != 0) {
      sendError(exchange, 400, "Vote must be 1, -1, or 0.");
      return;
    }
    String ip = clientIp(exchange);
    String tag = voterTag(postId, ip);
    Map<String, Object> out = store.vote(postId, tag, value);
    if (out == null) {
      sendError(exchange, 404, "Post not found.");
      return;
    }
    out.put("yourVote", store.voteOf(postId, tag));
    sendJson(exchange, 200, out);
  }

  private void createThread(HttpExchange exchange) throws IOException {
    Map<String, Object> body = readJsonObject(exchange);
    if (body == null) {
      return;
    }
    if (!checkProof(exchange, body)) {
      return;
    }
    String boardId = asString(body.get("boardId"));
    String subject = trimmed(asString(body.get("subject")));
    String text = asString(body.get("body"));
    if (boardId == null || !store.hasBoard(boardId)) {
      sendError(exchange, 400, "Unknown board.");
      return;
    }
    if (subject == null || subject.isEmpty() || subject.length() > MAX_SUBJECT_CHARS) {
      sendError(exchange, 400, "Subject must be 1-" + MAX_SUBJECT_CHARS + " characters.");
      return;
    }
    if (!validBody(text)) {
      sendError(exchange, 400, "Body must be 1-" + MAX_BODY_CHARS + " characters of text.");
      return;
    }
    String ip = clientIp(exchange);
    String threadId =
        store.createThread(boardId, subject, text, id -> posterIds.idFor(id, ip));
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("threadId", threadId);
    out.put("posterId", posterIds.idFor(threadId, ip));
    sendJson(exchange, 200, out);
  }

  private void createPost(HttpExchange exchange, String threadId) throws IOException {
    Map<String, Object> body = readJsonObject(exchange);
    if (body == null) {
      return;
    }
    if (!checkProof(exchange, body)) {
      return;
    }
    String text = asString(body.get("body"));
    if (!validBody(text)) {
      sendError(exchange, 400, "Body must be 1-" + MAX_BODY_CHARS + " characters of text.");
      return;
    }
    String ip = clientIp(exchange);
    String postId = store.createPost(threadId, text, id -> posterIds.idFor(id, ip));
    if (postId == null) {
      sendError(exchange, 404, "Thread not found.");
      return;
    }
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("postId", postId);
    out.put("posterId", posterIds.idFor(threadId, ip));
    sendJson(exchange, 200, out);
  }

  private void removePost(HttpExchange exchange, String postId) throws IOException {
    String configured = config.adminKey();
    if (configured == null || configured.isEmpty()) {
      sendError(exchange, 403, "Removal is not configured on this server.");
      return;
    }
    String supplied = exchange.getRequestHeaders().getFirst("X-Admin-Key");
    if (supplied == null
        || !MessageDigest.isEqual(
            supplied.getBytes(StandardCharsets.UTF_8),
            configured.getBytes(StandardCharsets.UTF_8))) {
      sendError(exchange, 403, "Bad admin key.");
      return;
    }
    if (!store.removePost(postId)) {
      sendError(exchange, 404, "Post not found.");
      return;
    }
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("removed", Boolean.TRUE);
    sendJson(exchange, 200, out);
  }

  /* ---------------------------------------------------------------- *
   * Static site
   *
   * With site-dir configured, everything outside /api serves the forum's
   * own pages, so the site and its API share one origin — no CORS in play,
   * and the pages get their CSP as a real response header (the only place
   * frame-ancestors works). Files are read from disk per request; the site
   * is a handful of small files and this keeps live-editing possible.
   * ---------------------------------------------------------------- */

  private static final Map<String, String> CONTENT_TYPES =
      Map.ofEntries(
          Map.entry("html", "text/html; charset=utf-8"),
          Map.entry("css", "text/css; charset=utf-8"),
          Map.entry("js", "text/javascript; charset=utf-8"),
          Map.entry("mjs", "text/javascript; charset=utf-8"),
          Map.entry("json", "application/json; charset=utf-8"),
          Map.entry("txt", "text/plain; charset=utf-8"),
          Map.entry("md", "text/plain; charset=utf-8"),
          Map.entry("svg", "image/svg+xml"),
          Map.entry("png", "image/png"),
          Map.entry("jpg", "image/jpeg"),
          Map.entry("jpeg", "image/jpeg"),
          Map.entry("webp", "image/webp"),
          Map.entry("gif", "image/gif"),
          Map.entry("ico", "image/x-icon"),
          Map.entry("woff2", "font/woff2"),
          Map.entry("woff", "font/woff"),
          Map.entry("webm", "video/webm"),
          Map.entry("mp4", "video/mp4"));

  private static final String PAGE_CSP =
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
          + "connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";

  private void serveStatic(HttpExchange exchange, String path) throws IOException {
    Path root = config.siteDir();
    if (root == null) {
      sendError(exchange, 404, "Not found.");
      return;
    }
    if (!exchange.getRequestMethod().equals("GET")
        && !exchange.getRequestMethod().equals("HEAD")) {
      sendError(exchange, 405, "Method not allowed.");
      return;
    }
    root = root.toAbsolutePath().normalize();
    String clean = path.endsWith("/") ? path + "index.html" : path;
    Path file = root.resolve(clean.substring(1)).normalize();
    if (!file.startsWith(root) || !Files.isRegularFile(file)) {
      sendError(exchange, 404, "Not found.");
      return;
    }
    String name = file.getFileName().toString();
    int dot = name.lastIndexOf('.');
    String type =
        CONTENT_TYPES.getOrDefault(
            dot >= 0 ? name.substring(dot + 1).toLowerCase() : "", "application/octet-stream");

    var headers = exchange.getResponseHeaders();
    headers.set("Content-Type", type);
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Strict-Transport-Security", "max-age=31536000");
    if (type.startsWith("text/html")) {
      headers.set("Content-Security-Policy", PAGE_CSP);
      headers.set("Cache-Control", "no-cache");
    } else if (type.startsWith("text/") || type.startsWith("application/json")) {
      // CSS/JS must not get pinned at the CDN edge, or deploys go stale for
      // an hour. They're tiny; serving each request from here is nothing.
      headers.set("Cache-Control", "no-cache");
    } else {
      headers.set("Cache-Control", "public, max-age=3600");
    }
    byte[] bytes = Files.readAllBytes(file);
    if (exchange.getRequestMethod().equals("HEAD")) {
      exchange.sendResponseHeaders(200, -1);
      return;
    }
    exchange.sendResponseHeaders(200, bytes.length);
    try (OutputStream out = exchange.getResponseBody()) {
      out.write(bytes);
    }
  }

  /* ---------------------------------------------------------------- *
   * Request plumbing
   * ---------------------------------------------------------------- */

  private boolean checkProof(HttpExchange exchange, Map<String, Object> body) throws IOException {
    return checkProof(exchange, body, pow.difficulty());
  }

  private boolean checkProof(HttpExchange exchange, Map<String, Object> body, int minDifficulty)
      throws IOException {
    Object proofValue = body.get("proof");
    if (proofValue instanceof Map<?, ?> proof) {
      String seed = asString(proof.get("seed"));
      String nonce = nonceString(proof.get("nonce"));
      if (pow.verify(seed, nonce, minDifficulty)) {
        return true;
      }
    }
    sendError(exchange, 403, "Invalid proof of work.");
    return false;
  }

  /** The nonce hashes as its decimal string, exactly as pow.js interpolates it. */
  private static String nonceString(Object nonce) {
    if (nonce instanceof Long l) {
      return Long.toString(l);
    }
    if (nonce instanceof Double d && d == Math.floor(d) && !d.isInfinite()) {
      return Long.toString((long) (double) d);
    }
    if (nonce instanceof String s) {
      return s;
    }
    return null;
  }

  private Map<String, Object> readJsonObject(HttpExchange exchange) throws IOException {
    // Rule: only JSON text in, ever. There is no multipart handler in this
    // process, so uploads are impossible rather than merely rejected.
    String contentType = exchange.getRequestHeaders().getFirst("Content-Type");
    if (contentType != null && !contentType.toLowerCase().contains("application/json")) {
      sendError(exchange, 415, "JSON only.");
      return null;
    }
    byte[] raw = readLimited(exchange.getRequestBody());
    if (raw == null) {
      sendError(exchange, 413, "Request too large.");
      return null;
    }
    Object parsed;
    try {
      parsed = Json.parse(new String(raw, StandardCharsets.UTF_8));
    } catch (IllegalArgumentException e) {
      sendError(exchange, 400, "Malformed JSON.");
      return null;
    }
    if (!(parsed instanceof Map)) {
      sendError(exchange, 400, "Expected a JSON object.");
      return null;
    }
    @SuppressWarnings("unchecked")
    Map<String, Object> map = (Map<String, Object>) parsed;
    return map;
  }

  private static byte[] readLimited(InputStream in) throws IOException {
    byte[] data = in.readNBytes(MAX_REQUEST_BYTES + 1);
    return data.length > MAX_REQUEST_BYTES ? null : data;
  }

  private String clientIp(HttpExchange exchange) {
    String header = config.proxyIpHeader();
    if (header != null && !header.isEmpty()) {
      String value = exchange.getRequestHeaders().getFirst(header);
      if (value != null && !value.isBlank()) {
        return value.trim();
      }
    }
    return exchange.getRemoteAddress().getAddress().getHostAddress();
  }

  private void preflight(HttpExchange exchange) throws IOException {
    var headers = exchange.getResponseHeaders();
    applyCommonHeaders(exchange);
    headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key");
    headers.set("Access-Control-Max-Age", "86400");
    exchange.sendResponseHeaders(204, -1);
  }

  private void applyCommonHeaders(HttpExchange exchange) {
    var headers = exchange.getResponseHeaders();
    headers.set("Access-Control-Allow-Origin", config.allowedOrigin());
    if (!"*".equals(config.allowedOrigin())) {
      headers.set("Vary", "Origin");
    }
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cache-Control", "no-store");
  }

  private void sendJson(HttpExchange exchange, int status, Object value) throws IOException {
    applyCommonHeaders(exchange);
    byte[] bytes = Json.write(value).getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
    exchange.sendResponseHeaders(status, bytes.length);
    try (OutputStream out = exchange.getResponseBody()) {
      out.write(bytes);
    }
  }

  private void sendError(HttpExchange exchange, int status, String message) throws IOException {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("error", message);
    sendJson(exchange, status, out);
  }

  private static boolean validBody(String text) {
    return text != null && !text.isBlank() && text.length() <= MAX_BODY_CHARS;
  }

  private static String asString(Object value) {
    return value instanceof String s ? s : null;
  }

  private static String trimmed(String value) {
    return value == null ? null : value.trim();
  }
}
