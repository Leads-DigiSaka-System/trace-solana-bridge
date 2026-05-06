import crypto from "crypto";

/**
 * DistributionItem interface matching the on-chain structure
 */
export interface DistributionItem {
    item_type: number;
    item_name: string;
    quantity: number | string;
    unit: string;
    variety: string;
    serial_number: string;
    supplier_origin: string;
}

/**
 * Serializes a DistributionItem into a Borsh-compatible 234-byte buffer.
 * Layout:
 * - item_type: u8 (1)
 * - item_name: [u8; 50] (50)
 * - item_name_len: u8 (1)
 * - quantity: u64 (8)
 * - unit: [u8; 10] (10)
 * - unit_len: u8 (1)
 * - variety: [u8; 30] (30)
 * - variety_len: u8 (1)
 * - serial_number: [u8; 30] (30)
 * - serial_number_len: u8 (1)
 * - supplier_origin: [u8; 100] (100)
 * - supplier_origin_len: u8 (1)
 */
export function serializeDistributionItem(item: DistributionItem): Buffer {
    const buffer = Buffer.alloc(234);
    let offset = 0;

    // item_type: u8
    buffer.writeUInt8(item.item_type || 0, offset);
    offset += 1;

    // item_name: [u8; 50]
    const itemNameBuf = Buffer.from(item.item_name || "", "utf8");
    const nameToCopy = itemNameBuf.subarray(0, 50);
    nameToCopy.copy(buffer, offset);
    offset += 50;

    // item_name_len: u8
    buffer.writeUInt8(nameToCopy.length, offset);
    offset += 1;

    // quantity: u64 (LE)
    const qty = BigInt(String(item.quantity || 0));
    buffer.writeBigUInt64LE(qty, offset);
    offset += 8;

    // unit: [u8; 10]
    const unitBuf = Buffer.from(item.unit || "", "utf8");
    const unitToCopy = unitBuf.subarray(0, 10);
    unitToCopy.copy(buffer, offset);
    offset += 10;

    // unit_len: u8
    buffer.writeUInt8(unitToCopy.length, offset);
    offset += 1;

    // variety: [u8; 30]
    const varietyBuf = Buffer.from(item.variety || "", "utf8");
    const varietyToCopy = varietyBuf.subarray(0, 30);
    varietyToCopy.copy(buffer, offset);
    offset += 30;

    // variety_len: u8
    buffer.writeUInt8(varietyToCopy.length, offset);
    offset += 1;

    // serial_number: [u8; 30]
    const serialBuf = Buffer.from(item.serial_number || "", "utf8");
    const serialToCopy = serialBuf.subarray(0, 30);
    serialToCopy.copy(buffer, offset);
    offset += 30;

    // serial_number_len: u8
    buffer.writeUInt8(serialToCopy.length, offset);
    offset += 1;

    // supplier_origin: [u8; 100]
    const supplierBuf = Buffer.from(item.supplier_origin || "", "utf8");
    const supplierToCopy = supplierBuf.subarray(0, 100);
    supplierToCopy.copy(buffer, offset);
    offset += 100;

    // supplier_origin_len: u8
    buffer.writeUInt8(supplierToCopy.length, offset);
    offset += 1;

    return buffer;
}

/**
 * Hashes a leaf node (single item)
 */
export function hashLeaf(leaf: Buffer): Buffer {
    return crypto.createHash("sha256").update(leaf).digest();
}

/**
 * Hashes two child nodes to produce a parent node
 */
export function hashNodes(left: Buffer, right: Buffer): Buffer {
    return crypto
        .createHash("sha256")
        .update(Buffer.concat([left, right]))
        .digest();
}

/**
 * Builds a Merkle Tree from an array of DistributionItems
 */
export function buildItemsMerkleTree(items: DistributionItem[]) {
    const leafHashes = items.map((item) =>
        hashLeaf(serializeDistributionItem(item)),
    );

    if (leafHashes.length === 0) {
        return {
            root: Buffer.alloc(32),
            layers: [] as Buffer[][],
            leafHashes: [] as Buffer[],
        };
    }

    let currentLayer = leafHashes;
    const layers = [currentLayer];

    while (currentLayer.length > 1) {
        const nextLayer: Buffer[] = [];
        for (let i = 0; i < currentLayer.length; i += 2) {
            const left = currentLayer[i]!;
            const right =
                i + 1 < currentLayer.length ? currentLayer[i + 1]! : left; // Duplicate last leaf if odd
            nextLayer.push(hashNodes(left, right));
        }
        currentLayer = nextLayer;
        layers.push(currentLayer);
    }

    return {
        root: currentLayer[0]!,
        layers: layers,
        leafHashes: leafHashes,
    };
}

/**
 * Generates a Merkle Proof for a given leaf index
 */
export function generateProof(layers: Buffer[][], index: number) {
    const proof: { sibling: string; isLeft: boolean }[] = [];
    let currentIndex = index;

    for (let i = 0; i < layers.length - 1; i++) {
        const layer = layers[i]!;
        const isRight = currentIndex % 2 === 1;
        const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

        if (siblingIndex < layer.length) {
            proof.push({
                sibling: layer[siblingIndex]!.toString("hex"),
                isLeft: isRight,
            });
        } else {
            // Duplicate self (standard approach for odd-numbered trees)
            proof.push({
                sibling: layer[currentIndex]!.toString("hex"),
                isLeft: isRight,
            });
        }
        currentIndex = Math.floor(currentIndex / 2);
    }

    return proof;
}

/**
 * Verifies a Merkle Proof against a root hash
 */
export function verifyProof(
    root: Buffer,
    leaf: Buffer,
    proof: { sibling: string; isLeft: boolean }[],
): boolean {
    let currentHash = leaf;
    for (const p of proof) {
        const sibling = Buffer.from(p.sibling, "hex");
        if (p.isLeft) {
            currentHash = hashNodes(sibling, currentHash);
        } else {
            currentHash = hashNodes(currentHash, sibling);
        }
    }
    return root.equals(currentHash);
}
