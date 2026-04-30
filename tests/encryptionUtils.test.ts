import {
    encrypt,
    decrypt,
    generateDataHash,
    padBuffer,
} from "../src/utils/encryptionUtils";
import crypto from "crypto";

describe("encryptionUtils", () => {
    const key = crypto.randomBytes(32).toString("hex");

    test("should encrypt and decrypt a string", () => {
        const text = "Hello DigiSaka!";
        const encrypted = encrypt(text, key);
        expect(encrypted.length).toBeGreaterThan(16); // IV (16) + at least one block (16)

        const decrypted = decrypt(encrypted, key);
        expect(decrypted).toBe(text);
    });

    test("should generate consistent hash for same data", () => {
        const data1 = { name: "Juan", id: 123 };
        const data2 = { id: 123, name: "Juan" };

        const hash1 = generateDataHash(data1);
        const hash2 = generateDataHash(data2);

        expect(hash1).toEqual(hash2);
        expect(hash1.length).toBe(32);
    });

    test("should pad buffer to correct length", () => {
        const buffer = Buffer.from("test");
        const length = 16;
        const padded = padBuffer(buffer, length);

        expect(padded.length).toBe(length);
        expect(padded.subarray(0, 4).toString()).toBe("test");
        expect(padded[4]).toBe(0);
    });

    test("should throw error if buffer length exceeds target length in padBuffer", () => {
        const buffer = Buffer.alloc(20);
        expect(() => padBuffer(buffer, 16)).toThrow();
    });
});
