import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const CURRENT_KEY_VERSION = 1;

function getEncryptionKey(): Buffer {
  const keySource = process.env.META_ENCRYPTION_KEY;
  if (!keySource || keySource.length < 16) {
    throw new Error("[MetaCrypto] META_ENCRYPTION_KEY is not set or too short. Must be at least 16 characters.");
  }
  return crypto.createHash("sha256").update(keySource).digest();
}

export function encryptToken(plaintext: string): { ciphertext: string; iv: string; keyVersion: number } {
  if (!plaintext) {
    throw new Error("[MetaCrypto] Cannot encrypt empty token");
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return {
    ciphertext: encrypted + ":" + authTag,
    iv: iv.toString("hex"),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

export function decryptToken(ciphertext: string, iv: string, keyVersion: number): string {
  if (!ciphertext || !iv) {
    throw new Error("[MetaCrypto] Cannot decrypt: missing ciphertext or IV");
  }

  if (keyVersion !== CURRENT_KEY_VERSION) {
    throw new Error(`[MetaCrypto] Unsupported key version: ${keyVersion}. Current version: ${CURRENT_KEY_VERSION}`);
  }

  const key = getEncryptionKey();
  const ivBuffer = Buffer.from(iv, "hex");
  const parts = ciphertext.split(":");
  if (parts.length !== 2) {
    throw new Error("[MetaCrypto] Invalid ciphertext format");
  }

  const encryptedData = parts[0];
  const authTag = Buffer.from(parts[1], "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBuffer, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedData, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

export function redactToken(token: string | null | undefined): string {
  if (!token) return "[NOT_SET]";
  if (token.length <= 8) return "[REDACTED]";
  return token.substring(0, 4) + "..." + token.substring(token.length - 4);
}

export function isEncryptionConfigured(): boolean {
  const key = process.env.META_ENCRYPTION_KEY;
  return !!key && key.length >= 16;
}
