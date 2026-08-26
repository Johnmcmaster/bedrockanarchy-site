/*
 * Proof-of-work spam control.
 *
 * A forum with no accounts cannot rate-limit by user, and rate-limiting by IP
 * means storing IPs, which is exactly what this site refuses to do. So the cost
 * of posting is paid in CPU instead: the browser must find a nonce whose
 * SHA-256 digest starts with N zero bits before the post is accepted.
 *
 * A human posting once every few minutes never notices it. A script trying to
 * flood the board pays the same cost on every single post.
 *
 * No captcha, no third-party challenge widget, no fingerprinting, nothing that
 * identifies who solved it.
 */

const encoder = new TextEncoder();

function leadingZeroBits(bytes) {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

async function digest(seed, nonce) {
  const buffer = await crypto.subtle.digest("SHA-256", encoder.encode(`${seed}:${nonce}`));
  return new Uint8Array(buffer);
}

/**
 * Solve a challenge. Yields to the event loop periodically so the page stays
 * responsive and onProgress can update the UI.
 *
 * @param {{seed: string, difficulty: number}} challenge
 * @param {(attempts: number) => void} [onProgress]
 * @returns {Promise<{seed: string, nonce: number, attempts: number}>}
 */
export async function solve(challenge, onProgress) {
  const { seed, difficulty } = challenge;
  let nonce = 0;

  for (;;) {
    const hash = await digest(seed, nonce);
    if (leadingZeroBits(hash) >= difficulty) {
      return { seed, nonce, attempts: nonce + 1 };
    }

    nonce += 1;

    if (nonce % 500 === 0) {
      onProgress?.(nonce);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

/** Server-side check, mirrored here so the mock backend can verify too. */
export async function verify(seed, nonce, difficulty) {
  const hash = await digest(seed, nonce);
  return leadingZeroBits(hash) >= difficulty;
}
