package org.nocoords.forum;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/*
 * Per-thread anonymous poster IDs: HMAC-SHA256(secret, threadId + "|" + ip),
 * first three bytes as hex. The secret lives only in memory and rotates every
 * 24 hours, so the IDs expire on their own and can never be reversed into an
 * address. The IP is used for the single HMAC computation and discarded — it
 * is never stored, logged, or passed anywhere else.
 */
public final class PosterIds {

  private static final long ROTATE_MS = 24 * 60 * 60_000;

  private final SecureRandom random = new SecureRandom();
  private byte[] secret;
  private long secretBorn;

  public synchronized String idFor(String threadId, String ip) {
    long now = System.currentTimeMillis();
    if (secret == null || now - secretBorn > ROTATE_MS) {
      secret = new byte[32];
      random.nextBytes(secret);
      secretBorn = now;
    }
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(secret, "HmacSHA256"));
      byte[] digest = mac.doFinal((threadId + "|" + ip).getBytes(StandardCharsets.UTF_8));
      byte[] head = new byte[3];
      System.arraycopy(digest, 0, head, 0, 3);
      return Pow.hex(head);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }
}
