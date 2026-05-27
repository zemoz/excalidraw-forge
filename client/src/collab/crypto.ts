// AES-GCM helpers — same shape as the original excalidraw-app/data/encryption.
// The room key is a 22-char base64 string carried in the URL hash; the server
// never sees it.

const IV_LENGTH_BYTES = 12;
const KEY_BITS = 128;

const importKey = (key: string, usage: KeyUsage) =>
  window.crypto.subtle.importKey(
    "jwk",
    {
      alg: "A128GCM",
      ext: true,
      k: key,
      key_ops: ["encrypt", "decrypt"],
      kty: "oct",
    },
    { name: "AES-GCM", length: KEY_BITS },
    false,
    [usage],
  );

export const generateEncryptionKey = async (): Promise<string> => {
  const key = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: KEY_BITS },
    true,
    ["encrypt", "decrypt"],
  );
  const jwk = await window.crypto.subtle.exportKey("jwk", key);
  if (!jwk.k) throw new Error("Failed to export key");
  return jwk.k;
};

export const encryptData = async (
  key: string,
  data: BufferSource,
): Promise<{ encryptedBuffer: ArrayBuffer; iv: Uint8Array }> => {
  const cryptoKey = await importKey(key, "encrypt");
  const iv = window.crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const encryptedBuffer = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    cryptoKey,
    data,
  );
  return { encryptedBuffer, iv };
};

export const decryptData = async (
  key: string,
  iv: BufferSource,
  ciphertext: BufferSource,
): Promise<ArrayBuffer> => {
  const cryptoKey = await importKey(key, "decrypt");
  return window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    ciphertext,
  );
};
