import { describe, it, expect } from "@jest/globals";
import crypto from "crypto";
import {
    serializeDistributionItem,
    buildItemsMerkleTree,
    generateProof,
    verifyProof,
} from "../../src/utils/merkle.js";
import type { DistributionItem } from "../../src/utils/merkle.js";

describe("Merkle Utility", () => {
    const items: DistributionItem[] = [
        {
            item_type: 1,
            item_name: "Seeds",
            quantity: 100,
            unit: "kg",
            variety: "NSIC Rc222",
            serial_number: "SN001",
            supplier_origin: "Supplier A",
        },
        {
            item_type: 2,
            item_name: "Fertilizer",
            quantity: 50,
            unit: "bag",
            variety: "Urea",
            serial_number: "SN002",
            supplier_origin: "Supplier B",
        },
    ];

    it("should serialize distribution item to 234 bytes", () => {
        const buffer = serializeDistributionItem(items[0]);
        expect(buffer.length).toBe(234);
        expect(buffer[0]).toBe(1); // item_type
        // check name length at offset 51
        expect(buffer[51]).toBe(5); // "Seeds".length
        // check quantity (8 bytes LE) starting at offset 52
        expect(buffer.readBigUInt64LE(52)).toBe(100n);
    });

    it("should build a merkle tree with 1 item", () => {
        const singleItem = [items[0]];
        const { root, layers, leafHashes } = buildItemsMerkleTree(singleItem);
        expect(layers.length).toBe(1);
        expect(root).toEqual(leafHashes[0]);
    });

    it("should build a merkle tree with 2 items", () => {
        const { root, layers, leafHashes } = buildItemsMerkleTree(items);
        expect(layers.length).toBe(2);
        // Root should be hash(leaf0 + leaf1)
        const expectedRoot = crypto
            .createHash("sha256")
            .update(Buffer.concat([leafHashes[0], leafHashes[1]]))
            .digest();
        expect(root).toEqual(expectedRoot);
    });

    it("should build a merkle tree with 3 items (odd number)", () => {
        const threeItems = [...items, items[0]];
        const { root, layers, leafHashes } = buildItemsMerkleTree(threeItems);
        // L0: [H0, H1, H2]
        // L1: [H(H0+H1), H(H2+H2)]
        // L2: [H(L1[0]+L1[1])]
        expect(layers.length).toBe(3);

        // Verify root calculation manually
        const L1_0 = crypto
            .createHash("sha256")
            .update(Buffer.concat([leafHashes[0], leafHashes[1]]))
            .digest();
        const L1_1 = crypto
            .createHash("sha256")
            .update(Buffer.concat([leafHashes[2], leafHashes[2]]))
            .digest();
        const expectedRoot = crypto
            .createHash("sha256")
            .update(Buffer.concat([L1_0, L1_1]))
            .digest();
        expect(root).toEqual(expectedRoot);
    });

    it("should generate and verify proof for 2 items", () => {
        const { root, layers, leafHashes } = buildItemsMerkleTree(items);

        const proof0 = generateProof(layers, 0);
        expect(verifyProof(root, leafHashes[0], proof0)).toBe(true);

        const proof1 = generateProof(layers, 1);
        expect(verifyProof(root, leafHashes[1], proof1)).toBe(true);
    });

    it("should generate and verify proof for 5 items", () => {
        const fiveItems = [items[0], items[1], items[0], items[1], items[0]];
        const { root, layers, leafHashes } = buildItemsMerkleTree(fiveItems);

        expect(layers.length).toBe(4); // L0: 5, L1: 3, L2: 2, L3: 1

        for (let i = 0; i < 5; i++) {
            const proof = generateProof(layers, i);
            expect(verifyProof(root, leafHashes[i], proof)).toBe(true);
        }
    });

    it("should fail verification with wrong leaf", () => {
        const { root, layers, leafHashes } = buildItemsMerkleTree(items);
        const proof0 = generateProof(layers, 0);
        expect(verifyProof(root, leafHashes[1], proof0)).toBe(false);
    });

    it("should fail verification with tampered proof", () => {
        const { root, layers, leafHashes } = buildItemsMerkleTree(items);
        const proof0 = generateProof(layers, 0);
        proof0[0].sibling = crypto.randomBytes(32).toString("hex");
        expect(verifyProof(root, leafHashes[0], proof0)).toBe(false);
    });
});
