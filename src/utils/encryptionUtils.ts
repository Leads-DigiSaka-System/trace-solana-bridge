import crypto from "crypto";

/**
 * Encrypts a string using AES-256-CBC
 * @param text The plaintext to encrypt
 * @param keyHex The 32-byte hex key
 * @returns Buffer containing IV (16 bytes) + ciphertext
 */
export const encrypt = (text: string, keyHex: string): Buffer => {
    if (!text) return Buffer.alloc(0);
    const key = Buffer.from(keyHex, "hex");
    if (key.length !== 32) {
        throw new Error(
            "Invalid key length. Key must be 32 bytes (64 hex characters).",
        );
    }
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    let encrypted = cipher.update(text, "utf8");
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return Buffer.concat([iv, encrypted]);
};

/**
 * Decrypts a buffer using AES-256-CBC
 * @param encryptedBuffer Buffer containing IV (16 bytes) + ciphertext
 * @param keyHex The 32-byte hex key
 * @returns Decrypted plaintext string
 */
export const decrypt = (encryptedBuffer: Buffer, keyHex: string): string => {
    if (!encryptedBuffer || encryptedBuffer.length < 16) return "";
    const key = Buffer.from(keyHex, "hex");
    const iv = encryptedBuffer.subarray(0, 16);
    const ciphertext = encryptedBuffer.subarray(16);
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString("utf8").replace(/\0+$/, ""); // Remove possible padding
};

/**
 * Generates a SHA-256 hash of the sensitive data fields for verification
 * @param data Object containing sensitive fields
 * @returns 32-byte hash buffer
 */
export const generateDataHash = (data: any): Buffer => {
    const hash = crypto.createHash("sha256");
    // Stringify with sorted keys for consistency
    const keys = Object.keys(data).sort();
    const values = keys.map((k) => {
        const val = data[k];
        return typeof val === "object" ? JSON.stringify(val) : String(val);
    });
    hash.update(values.join("|"));
    return hash.digest();
};

/**
 * Pads a buffer to a fixed length for Solana account storage
 * @param buffer The buffer to pad
 * @param length The target length
 * @returns Padded buffer
 */
export const padBuffer = (buffer: Buffer, length: number): Buffer => {
    if (buffer.length > length) {
        throw new Error(
            `Buffer length ${buffer.length} exceeds target length ${length}`,
        );
    }
    const padded = Buffer.alloc(length);
    buffer.copy(padded);
    return padded;
};
