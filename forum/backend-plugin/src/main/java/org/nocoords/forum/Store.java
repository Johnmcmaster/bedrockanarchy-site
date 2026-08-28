package org.nocoords.forum;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.regex.Pattern;

/*
 * All forum data, held in memory and persisted to one human-readable JSON
 * file. A text-only forum is small — years of posts fit comfortably in RAM —
 * and a single flat file means removal really removes (the file is rewritten
 * whole, so a deleted body is not lurking in old pages the way it can in a
 * database), backups stay trivial, and the operator can read or edit the data
 * with any text editor while the server is stopped.
 *
 * Every mutation writes the file atomically (temp file + rename), so a crash
 * can never leave it half-written.
 *
 * What is stored per post: id, threadId, posterId (3-byte HMAC tag), body,
 * createdAt, removed. Nothing else exists to store.
 */
public final class Store {

  public static final class Board {
    String id;
    String name;
    String description;
  }

  public static final class ForumThread {
    String id;
    String boardId;
    String subject;
    long createdAt;
    long bumpedAt;
  }

  public static final class Post {
    String id;
    String threadId;
    String posterId;
    String body;
    long createdAt;
    boolean removed;
    // Voter tag (rotating-secret HMAC, same privacy budget as posterId) -> ±1.
    final LinkedHashMap<String, Long> votes = new LinkedHashMap<>();
  }

  private static final Pattern BOOK = Pattern.compile("^/book(\\s|$)");
  private static final Pattern MOJANGLES = Pattern.compile("^/mojangles(\\s|$)");
  private static final Pattern FORMAT_CODES =
      Pattern.compile("§[0-9a-fk-or]", Pattern.CASE_INSENSITIVE);

  private final Path file;
  private long seq = 1;
  private final LinkedHashMap<String, Board> boards = new LinkedHashMap<>();
  private final ArrayList<ForumThread> threads = new ArrayList<>();
  private final ArrayList<Post> posts = new ArrayList<>();

  public Store(Path file) throws IOException {
    this.file = file;
    load();
  }

  private void load() throws IOException {
    if (!Files.exists(file)) {
      seedBoards();
      save();
      return;
    }
    Object parsed = Json.parse(Files.readString(file, StandardCharsets.UTF_8));
    if (!(parsed instanceof Map<?, ?> root)) {
      throw new IOException("Data file is not a JSON object: " + file);
    }
    seq = asLong(root.get("seq"), 1);
    for (Object item : asList(root.get("boards"))) {
      Map<?, ?> data = (Map<?, ?>) item;
      Board board = new Board();
      board.id = (String) data.get("id");
      board.name = (String) data.get("name");
      board.description = (String) data.get("description");
      boards.put(board.id, board);
    }
    for (Object item : asList(root.get("threads"))) {
      Map<?, ?> data = (Map<?, ?>) item;
      ForumThread thread = new ForumThread();
      thread.id = (String) data.get("id");
      thread.boardId = (String) data.get("boardId");
      thread.subject = (String) data.get("subject");
      thread.createdAt = asLong(data.get("createdAt"), 0);
      thread.bumpedAt = asLong(data.get("bumpedAt"), thread.createdAt);
      threads.add(thread);
    }
    for (Object item : asList(root.get("posts"))) {
      Map<?, ?> data = (Map<?, ?>) item;
      Post post = new Post();
      post.id = (String) data.get("id");
      post.threadId = (String) data.get("threadId");
      post.posterId = (String) data.get("posterId");
      post.body = (String) data.get("body");
      post.createdAt = asLong(data.get("createdAt"), 0);
      post.removed = Boolean.TRUE.equals(data.get("removed"));
      if (data.get("votes") instanceof Map<?, ?> votes) {
        for (Map.Entry<?, ?> vote : votes.entrySet()) {
          post.votes.put((String) vote.getKey(), asLong(vote.getValue(), 0));
        }
      }
      posts.add(post);
    }
    if (boards.isEmpty()) {
      seedBoards();
      save();
    }
  }

  private void seedBoards() {
    addBoard("b", "Random", "Anything at all. The default board.");
    addBoard("servers", "Servers", "Any anarchy server. Finds, reviews, drama, advertise yours.");
    addBoard("anarchy", "Anarchy", "Griefing, raiding, PvP, base war stories.");
    addBoard("tech", "Tech", "Redstone, farms, exploits, automation.");
    addBoard("meta", "Meta", "About this forum itself.");
  }

  private void addBoard(String id, String name, String description) {
    Board board = new Board();
    board.id = id;
    board.name = name;
    board.description = description;
    boards.put(id, board);
  }

  private synchronized void save() throws IOException {
    Map<String, Object> root = new LinkedHashMap<>();
    root.put("seq", seq);
    List<Object> boardList = new ArrayList<>();
    for (Board board : boards.values()) {
      Map<String, Object> data = new LinkedHashMap<>();
      data.put("id", board.id);
      data.put("name", board.name);
      data.put("description", board.description);
      boardList.add(data);
    }
    root.put("boards", boardList);
    List<Object> threadList = new ArrayList<>();
    for (ForumThread thread : threads) {
      threadList.add(threadJson(thread));
    }
    root.put("threads", threadList);
    List<Object> postList = new ArrayList<>();
    for (Post post : posts) {
      Map<String, Object> data = postJson(post);
      data.remove("ups");
      data.remove("downs");
      data.put("votes", new LinkedHashMap<>(post.votes));
      postList.add(data);
    }
    root.put("posts", postList);

    Path parent = file.toAbsolutePath().getParent();
    if (parent != null) {
      Files.createDirectories(parent);
    }
    Path temp = file.resolveSibling(file.getFileName() + ".tmp");
    Files.writeString(temp, Json.write(root), StandardCharsets.UTF_8);
    try {
      Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    } catch (IOException e) {
      Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING);
    }
  }

  public synchronized List<Object> listBoards() {
    List<Object> out = new ArrayList<>();
    for (Board board : boards.values()) {
      long count = threads.stream().filter(t -> t.boardId.equals(board.id)).count();
      Map<String, Object> data = new LinkedHashMap<>();
      data.put("id", board.id);
      data.put("name", board.name);
      data.put("description", board.description);
      data.put("threadCount", count);
      out.add(data);
    }
    return out;
  }

  public synchronized boolean hasBoard(String boardId) {
    return boards.containsKey(boardId);
  }

  public synchronized List<Object> listThreads(String boardId) {
    List<ForumThread> matching = new ArrayList<>();
    for (ForumThread thread : threads) {
      if (boardId == null || thread.boardId.equals(boardId)) {
        matching.add(thread);
      }
    }
    matching.sort((a, b) -> Long.compare(b.bumpedAt, a.bumpedAt));
    List<Object> out = new ArrayList<>();
    for (ForumThread thread : matching) {
      List<Post> threadPosts = postsOf(thread.id);
      Post op = threadPosts.isEmpty() ? null : threadPosts.get(0);
      Map<String, Object> data = threadJson(thread);
      data.put("replyCount", (long) Math.max(threadPosts.size() - 1, 0));
      data.put("excerpt", op != null && !op.removed ? excerptOf(op.body) : "[removed]");
      data.put("score", op == null ? 0L : scoreOf(op));
      out.add(data);
    }
    return out;
  }

  public synchronized Map<String, Object> getThread(String threadId) {
    ForumThread thread = findThread(threadId);
    if (thread == null) {
      return null;
    }
    List<Post> threadPosts = postsOf(threadId);
    threadPosts.sort((a, b) -> Long.compare(a.createdAt, b.createdAt));
    List<Object> postList = new ArrayList<>();
    for (Post post : threadPosts) {
      postList.add(postJson(post));
    }
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("thread", threadJson(thread));
    out.put("posts", postList);
    return out;
  }

  /**
   * Create a thread plus its OP post. The poster ID depends on the new thread
   * ID, so it is supplied as a function of that ID.
   */
  public synchronized String createThread(
      String boardId, String subject, String body, Function<String, String> posterIdFor)
      throws IOException {
    String threadId = "t" + seq++;
    long now = System.currentTimeMillis();

    ForumThread thread = new ForumThread();
    thread.id = threadId;
    thread.boardId = boardId;
    thread.subject = subject;
    thread.createdAt = now;
    thread.bumpedAt = now;
    threads.add(thread);

    Post post = new Post();
    post.id = "p" + seq++;
    post.threadId = threadId;
    post.posterId = posterIdFor.apply(threadId);
    post.body = body;
    post.createdAt = now;
    posts.add(post);

    save();
    return threadId;
  }

  /** Create a reply. Returns the post ID, or null if the thread does not exist. */
  public synchronized String createPost(
      String threadId, String body, Function<String, String> posterIdFor) throws IOException {
    ForumThread thread = findThread(threadId);
    if (thread == null) {
      return null;
    }
    long now = System.currentTimeMillis();
    Post post = new Post();
    post.id = "p" + seq++;
    post.threadId = threadId;
    post.posterId = posterIdFor.apply(threadId);
    post.body = body;
    post.createdAt = now;
    posts.add(post);
    thread.bumpedAt = now;
    save();
    return post.id;
  }

  /** Blank a post. The body is gone from the data file, not just hidden. */
  public synchronized boolean removePost(String postId) throws IOException {
    for (Post post : posts) {
      if (post.id.equals(postId)) {
        post.removed = true;
        post.body = "";
        save();
        return true;
      }
    }
    return false;
  }

  public synchronized void flush() throws IOException {
    save();
  }

  /**
   * Record a vote (+1, -1, or 0 to clear) under a voter tag. One tag holds
   * one vote per post; voting again overwrites. Returns the updated
   * {ups, downs} counts, or null if the post is missing or removed.
   */
  public synchronized Map<String, Object> vote(String postId, String tag, long value)
      throws IOException {
    for (Post post : posts) {
      if (post.id.equals(postId)) {
        if (post.removed) {
          return null;
        }
        if (value == 0) {
          post.votes.remove(tag);
        } else {
          post.votes.put(tag, value > 0 ? 1L : -1L);
        }
        save();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ups", ups(post));
        out.put("downs", downs(post));
        return out;
      }
    }
    return null;
  }

  /** The vote a tag currently holds on a post: 1, -1, or 0. */
  public synchronized long voteOf(String postId, String tag) {
    for (Post post : posts) {
      if (post.id.equals(postId)) {
        return post.votes.getOrDefault(tag, 0L);
      }
    }
    return 0;
  }

  private static long ups(Post post) {
    return post.votes.values().stream().filter(v -> v > 0).count();
  }

  private static long downs(Post post) {
    return post.votes.values().stream().filter(v -> v < 0).count();
  }

  private static long scoreOf(Post post) {
    return ups(post) - downs(post);
  }

  private ForumThread findThread(String threadId) {
    for (ForumThread thread : threads) {
      if (thread.id.equals(threadId)) {
        return thread;
      }
    }
    return null;
  }

  private List<Post> postsOf(String threadId) {
    List<Post> out = new ArrayList<>();
    for (Post post : posts) {
      if (post.threadId.equals(threadId)) {
        out.add(post);
      }
    }
    return out;
  }

  private static Map<String, Object> threadJson(ForumThread thread) {
    Map<String, Object> data = new LinkedHashMap<>();
    data.put("id", thread.id);
    data.put("boardId", thread.boardId);
    data.put("subject", thread.subject);
    data.put("createdAt", thread.createdAt);
    data.put("bumpedAt", thread.bumpedAt);
    return data;
  }

  private static Map<String, Object> postJson(Post post) {
    Map<String, Object> data = new LinkedHashMap<>();
    data.put("id", post.id);
    data.put("threadId", post.threadId);
    data.put("posterId", post.posterId);
    data.put("body", post.body);
    data.put("createdAt", post.createdAt);
    data.put("removed", post.removed);
    data.put("ups", ups(post));
    data.put("downs", downs(post));
    return data;
  }

  /** Mirrors excerptOf in api.js so listings look identical either way. */
  static String excerptOf(String body) {
    if (body.startsWith("nc1.")) {
      return "[sealed post]";
    }
    if (BOOK.matcher(body).find()) {
      String firstLine = body.split("\n", 2)[0].replaceFirst("^/book\\s*", "").trim();
      return "[book] " + (firstLine.isEmpty() ? "Untitled" : firstLine);
    }
    if (MOJANGLES.matcher(body).find()) {
      body = body.replaceFirst("^/mojangles\\s*", "");
    }
    String flat = FORMAT_CODES.matcher(body).replaceAll("").replaceAll("\\s+", " ").trim();
    return flat.length() > 180 ? flat.substring(0, 180) + "…" : flat;
  }

  private static long asLong(Object value, long fallback) {
    if (value instanceof Long l) {
      return l;
    }
    if (value instanceof Double d) {
      return (long) (double) d;
    }
    return fallback;
  }

  private static List<?> asList(Object value) {
    return value instanceof List<?> list ? list : List.of();
  }
}
