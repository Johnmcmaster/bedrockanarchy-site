package org.nocoords.forum;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/*
 * Proof-of-work challenges, mirroring pow.js exactly: the client must find a
 * nonce such that SHA-256(seed + ":" + nonce) has at least `difficulty` leading
 * zero bits. Seeds are single-use and expire after five minutes, tracked in
 * memory only — nothing about who solved a challenge is ever recorded.
 */
public final class Pow {

  private static final long SEED_TTL_MS = 5 * 60_000;
  private static final int MAX_OUTSTANDING = 100_000;

  private record Seed(long expiry, int difficulty) {}

  private final SecureRandom random = new SecureRandom();
  private final Map<String, Seed> seeds = new ConcurrentHashMap<>();
  private final int difficulty;

  public Pow(int difficulty) {
    this.difficulty = difficulty;
  }

  public int difficulty() {
    return difficulty;
  }

  /**
   * Issue a fresh seed at the given difficulty, or null if the
   * outstanding-seed table is full. The difficulty is remembered per seed, so
   * an easy seed can never be spent on an action that demands a harder one.
   */
  public String issue(int seedDifficulty) {
    purgeExpired();
    if (seeds.size() >= MAX_OUTSTANDING) {
      return null;
    }
    byte[] bytes = new byte[12];
    random.nextBytes(bytes);
    String seed = hex(bytes);
    seeds.put(seed, new Seed(System.currentTimeMillis() + SEED_TTL_MS, seedDifficulty));
    return seed;
  }

  public String issue() {
    return issue(difficulty);
  }

  /**
   * Verify and consume a solution. A seed can only ever be spent once, and
   * only on an action requiring at most the difficulty it was issued for.
   */
  public boolean verify(String seed, String nonce, int minDifficulty) {
    if (seed == null || nonce == null) {
      return false;
    }
    Seed issued = seeds.remove(seed);
    if (issued == null || issued.expiry() < System.currentTimeMillis()) {
      return false;
    }
    if (issued.difficulty() < minDifficulty) {
      return false;
    }
    byte[] hash = sha256((seed + ":" + nonce).getBytes(StandardCharsets.UTF_8));
    return leadingZeroBits(hash) >= issued.difficulty();
  }

  public boolean verify(String seed, String nonce) {
    return verify(seed, nonce, difficulty);
  }

  private void purgeExpired() {
    long now = System.currentTimeMillis();
    Iterator<Map.Entry<String, Seed>> it = seeds.entrySet().iterator();
    while (it.hasNext()) {
      if (it.next().getValue().expiry() < now) {
        it.remove();
      }
    }
  }

  static int leadingZeroBits(byte[] bytes) {
    int bits = 0;
    for (byte b : bytes) {
      int value = b & 0xff;
      if (value == 0) {
        bits += 8;
        continue;
      }
      bits += Integer.numberOfLeadingZeros(value) - 24;
      break;
    }
    return bits;
  }

  static byte[] sha256(byte[] data) {
    try {
      return MessageDigest.getInstance("SHA-256").digest(data);
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  static String hex(byte[] bytes) {
    StringBuilder out = new StringBuilder(bytes.length * 2);
    for (byte b : bytes) {
      out.append(Character.forDigit((b >> 4) & 0xf, 16));
      out.append(Character.forDigit(b & 0xf, 16));
    }
    return out.toString();
  }
}
