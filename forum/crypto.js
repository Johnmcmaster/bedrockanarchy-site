/*
 * Optional end-to-end encryption for individual posts.
 *
 * This is real encryption, and it is the only part of the forum that gives you
 * secrecy from the server operator. A post sealed here is encrypted in the
 * poster's browser with a passphrase that is never transmitted. The backend,
 * the host, and anyone reading the database sees ciphertext only.
 *
 * What it is for: coordinates, base locations, group planning. Anything you
 * want a specific set of people to read and nobody else.
 *
 * What it is NOT: protection for ordinary public posts. A normal post is public
 * by definition, and no amount of storage encryption changes that, because the
 * key would have to ship to every reader.
 *
 * Scheme: PBKDF2-HMAC-SHA256 (300k iterations) -> AES-256-GCM.
 * Wire format: "nc1." + base64url(salt[16] || iv[12] || ciphertext)
 */

const PREFIX = "nc1.";
const PBKDF2_ITERATIONS = 300000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

function toBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function deriveKey(passphrase, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export function isSealed(body) {
  return typeof body === "string" && body.startsWith(PREFIX);
}

export async function seal(plaintext, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext)
    )
  );

  const packed = new Uint8Array(salt.length + iv.length + ciphertext.length);
  packed.set(salt, 0);
  packed.set(iv, salt.length);
  packed.set(ciphertext, salt.length + iv.length);

  return PREFIX + toBase64Url(packed);
}

export async function unseal(body, passphrase) {
  if (!isSealed(body)) {
    throw new Error("Post is not sealed.");
  }

  const packed = fromBase64Url(body.slice(PREFIX.length));
  const salt = packed.slice(0, SALT_BYTES);
  const iv = packed.slice(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const ciphertext = packed.slice(SALT_BYTES + IV_BYTES);
  const key = await deriveKey(passphrase, salt);

  // AES-GCM authenticates, so a wrong passphrase throws rather than returning junk.
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}
