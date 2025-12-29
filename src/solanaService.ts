import * as anchor from "@coral-xyz/anchor";
import {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
} from "@solana/web3.js";
import * as dotenv from "dotenv";
import { Buffer } from "buffer";
import type { Idl } from "@coral-xyz/anchor";
import BN from "bn.js";

// ESM JSON import
import idlJson from "./idl/digisaka_supply_chain.json" with { type: "json" };

dotenv.config();

if (!process.env.SOLANA_PROGRAM_ID) {
    throw new Error("CRITICAL: Missing SOLANA_PROGRAM_ID in .env");
}
if (!process.env.SOLANA_FEE_PAYER_SECRET_KEY) {
    throw new Error("CRITICAL: Missing SOLANA_FEE_PAYER_SECRET_KEY in .env");
}

const PROGRAM_ID = new PublicKey(process.env.SOLANA_PROGRAM_ID);

/**
 * Validate and convert actor_id to BN
 * 
 * This helper function centralizes actor_id validation and conversion logic
 * to prevent code duplication and ensure consistency across all Solana operations.
 * 
 * @param actor_id The actor ID (can be number, string, or undefined/null)
 * @param operationName Optional name of the operation for error messages (e.g., "creation", "update", "deletion")
 * @returns BN instance representing the validated actor_id
 * @throws Error if actor_id is invalid, missing, out of range, or zero
 */
function validateAndConvertActorId(actor_id: any, operationName: string = "operation"): BN {
    if (actor_id === undefined || actor_id === null) {
        throw new Error(`actor_id is required for ${operationName}`);
    }

    // Convert actor_id to string first to prevent precision loss, then to BN
    // Large numbers (> Number.MAX_SAFE_INTEGER) lose precision if passed as number
    const actorIdString = String(actor_id);
    
    // Validate it's a valid numeric string
    if (!/^\d+$/.test(actorIdString)) {
        throw new Error(`Invalid actor_id format: ${actor_id}. Must be a valid u64 (numeric string)`);
    }
    
    // Convert to BN (always use string to prevent precision loss)
    let actorIdBN: BN;
    try {
        actorIdBN = new BN(actorIdString, 10);
    } catch (err) {
        throw new Error(`Invalid actor_id format: ${actor_id}. Must be a valid u64 (number or numeric string)`);
    }

    // Validate actor_id is within u64 range (0 to 2^64-1)
    const MAX_U64 = new BN('18446744073709551615'); // 2^64 - 1
    if (actorIdBN.lt(new BN(0)) || actorIdBN.gt(MAX_U64)) {
        throw new Error(`actor_id out of range: ${actor_id}. Must be between 0 and 18446744073709551615`);
    }

    // Validate actor_id is not 0 (reserved/invalid)
    if (actorIdBN.eq(new BN(0))) {
        throw new Error(`actor_id cannot be 0. Invalid actor ID.`);
    }

    return actorIdBN;
}

// Connection
const connection = new Connection(
    process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    "processed"
);

// Fee payer
let secret: number[];

try {
    secret = JSON.parse(process.env.SOLANA_FEE_PAYER_SECRET_KEY);
} catch {
    throw new Error("SOLANA_FEE_PAYER_SECRET_KEY must be a valid JSON array of numbers");
}

const feePayer = Keypair.fromSecretKey(new Uint8Array(secret));

// Provider / Wallet
const wallet = new anchor.Wallet(feePayer);
const provider = new anchor.AnchorProvider(connection, wallet, {
    preflightCommitment: "confirmed",
});

anchor.setProvider(provider);

// Normalize JSON import
const idlContent: Idl = idlJson as Idl;
idlContent.address = PROGRAM_ID.toBase58();

// Try to fetch IDL from on-chain first, fallback to local IDL
let program: anchor.Program;
try {
    console.log("Attempting to fetch IDL from on-chain program...");
    const onChainIdl = await anchor.Program.fetchIdl(PROGRAM_ID, provider);
    if (onChainIdl) {
        console.log("Using on-chain IDL");
        program = new anchor.Program(onChainIdl, provider);
    } else {
        console.log("On-chain IDL not found, using local IDL");
        program = new anchor.Program(idlContent, provider);
    }
} catch (error) {
    console.warn("Failed to fetch on-chain IDL, using local IDL:", error);
    // Initialize program with new Anchor 0.30+ constructor (idl, provider)
    // The program ID is read from idl.address
    program = new anchor.Program(idlContent, provider);
}

// Quick method check
if (!program.methods) {
    throw new Error("CRITICAL: Anchor methods failed to load. IDL mismatch?");
}

// Log available methods for debugging
console.log("Program initialized. Available methods:", Object.keys(program.methods || {}));

export const checkProgramInitialization = async (): Promise<boolean> => {
    try {
        const acc = await connection.getAccountInfo(PROGRAM_ID);
        
        if (acc === null) {
            console.error("Program account not found:", PROGRAM_ID.toBase58());
            return false;
        }
        
        if (!acc.executable) {
            console.error("Program account exists but is not executable:", PROGRAM_ID.toBase58());
            return false;
        }
        
        return true;
    } catch (err) {
        console.error("Error during program initialization check:", err);
        throw new Error("Failed to communicate with Solana RPC");
    }
};

export const submitActorToSolana = async (actorData: any): Promise<string> => {
    const {
        actor_id,
        user_id,
        name,
        roles,              // JSON string or array of roles
        organization,        // Optional organization (BLO, Buyback, COOP)
        is_active,
        province,
        city,
        balance,
        pin,
        address,
        farm_id,
        farmer_id,
        assigned_tps,
    } = actorData;

    // ============================================
    // VALIDATE AND CONVERT actor_id
    // ============================================
    const actorIdBN = validateAndConvertActorId(actor_id, "creation");

    // ============================================
    // PARSE ROLES
    // ============================================
    let rolesString: string;
    if (typeof roles === 'string') {
        try {
            // Try to parse as JSON first
            const parsed = JSON.parse(roles);
            rolesString = Array.isArray(parsed) ? parsed.join(',') : roles;
        } catch {
            // If not JSON, assume it's already comma-separated
            rolesString = roles;
        }
    } else if (Array.isArray(roles)) {
        rolesString = roles.join(',');
    } else {
        rolesString = '';
    }

    // actor_type kept as 0 for backward compatibility (roles is the new way)
    const actorTypeU8 = 0;

    // Convert is_active boolean to u8 (0=false, 1=true)
    const isActiveU8 = is_active ? 1 : 0;

    // Convert balance to smallest unit (assuming balance is in main currency unit, convert to cents/smallest unit)
    // Adjust conversion based on Digisaka currency's smallest unit
    // Use string conversion to prevent precision loss with large numbers
    const balanceStr = String(balance || 0);
    const balanceNum = parseFloat(balanceStr);
    const balanceInSmallestUnit = Math.floor(balanceNum * 100); // Assuming 2 decimal places

    // ============================================
    // DERIVE PDA AND VERIFY
    // ============================================
    let actorPDA: PublicKey;
    let bump: number;
    
    try {
        [actorPDA, bump] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("actor"),
            feePayer.publicKey.toBuffer(),
                Buffer.from(actorIdBN.toArray("le", 8)),
        ],
        PROGRAM_ID
    );

        console.log("PDA Derivation:", {
            actor_id: actorIdBN.toString(),
            pda: actorPDA.toBase58(),
            bump: bump,
        });
        
        // Check if account already exists (pre-flight check)
        const accountInfo = await connection.getAccountInfo(actorPDA);
        if (accountInfo !== null) {
            throw new Error(
                `Actor account already exists on Solana. ` +
                `Actor ID: ${actorIdBN.toString()}, PDA: ${actorPDA.toBase58()}. ` +
                `This indicates an actor ID collision or duplicate creation attempt.`
            );
        }
    } catch (pdaErr: any) {
        if (pdaErr.message?.includes('already exists')) {
            throw pdaErr; // Re-throw account exists errors
        }
        throw new Error(`Failed to derive PDA for actor_id ${actorIdBN.toString()}: ${pdaErr.message}`);
    }

    // ============================================
    // EXECUTE ANCHOR INSTRUCTION
    // ============================================
    try {
        // Verify the method exists
        if (!program.methods.createActor) {
            console.error("Available methods:", Object.keys(program.methods));
            throw new Error("createActor method not found in program. Available methods: " + Object.keys(program.methods).join(", "));
        }

        console.log("Calling createActor with data:", {
            actor_id: actorIdBN.toString(),
            user_id,
            name,
            roles: rolesString,
            organization,
            actor_type: actorTypeU8,
            is_active: isActiveU8,
            province,
            city,
            balance: balanceInSmallestUnit,
            pin,
            address,
            farm_id,
            farmer_id,
            assigned_tps
        });

        const txSig = await program.methods
            .createActor(
                actorIdBN, // Use validated BN
                new BN(String(user_id), 10), // Convert to string first to prevent precision loss
                name || "",
                actorTypeU8,
                rolesString || "",
                organization || null,
                isActiveU8,
                province || "",
                city || "",
                new BN(String(balanceInSmallestUnit), 10), // Convert to string first
                pin || "000000",
                address || "",
                farm_id || "",
                new BN(String(farmer_id), 10), // Convert to string first
                new BN(String(assigned_tps), 10) // Convert to string first
            )
            .accounts({
                actor: actorPDA,
                authority: wallet.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([feePayer])
            .rpc();

        console.log("Actor Created on Solana:", txSig);
        return txSig;
    } catch (err: any) {
        console.error("Anchor Program Call Failed:", err);
        console.error("Error details:", {
            message: err.message,
            stack: err.stack,
            name: err.name,
            cause: err.cause
        });
        
        // Check for specific Anchor errors
        if (err.message?.includes('assertion') || err.message?.includes('Assertion')) {
            console.error("PDA Derivation Debug:", {
                actor_id: actor_id,
                actor_id_type: typeof actor_id,
                actor_id_bn: actorIdBN.toString(),
                calculated_pda: actorPDA.toBase58(),
                authority: feePayer.publicKey.toBase58(),
            });
            
            throw new Error(
                `Solana assertion failed: PDA derivation mismatch. ` +
                `This usually means actor_id is invalid or account already exists. ` +
                `Actor ID: ${actorIdBN.toString()}, PDA: ${actorPDA.toBase58()}. ` +
                `Original error: ${err.message}`
            );
        }
        
        throw new Error(`Failed to execute Anchor instruction: ${err.message || err.toString()}`);
    }
};

/**
 * Check if an actor account exists on Solana
 * @param actorId The actor ID to check (number or string - BN handles both)
 * @returns true if actor exists, false otherwise
 */
export const checkActorExistsOnSolana = async (actorId: number | string): Promise<boolean> => {
    try {
        // Convert actorId to BN - always convert to string first to prevent precision loss
        // Large numbers (> Number.MAX_SAFE_INTEGER) lose precision if passed as number
        const actorIdString = String(actorId);
        
        // Validate it's a valid numeric string
        if (!/^\d+$/.test(actorIdString)) {
            throw new Error(`Invalid actor_id format: ${actorId}. Must be a valid u64 (numeric string)`);
        }
        
        // Create BN from string to preserve precision
        const actorIdBN = new BN(actorIdString, 10);
        
        // PDA for actor account (seeds: "actor", authority, actor_id)
        const [actorPDA] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("actor"),
                feePayer.publicKey.toBuffer(),
                Buffer.from(actorIdBN.toArray("le", 8)),
            ],
            PROGRAM_ID
        );

        // Check if account exists
        const accountInfo = await connection.getAccountInfo(actorPDA);
        
        if (accountInfo === null) {
            console.log(`Actor ${actorIdBN.toString()} does not exist on Solana (PDA: ${actorPDA.toBase58()})`);
            return false;
        }

        // Verify it's owned by our program
        if (!accountInfo.owner.equals(PROGRAM_ID)) {
            console.warn(`Actor ${actorIdBN.toString()} account exists but is not owned by our program`);
            return false;
        }

        console.log(`Actor ${actorIdBN.toString()} exists on Solana (PDA: ${actorPDA.toBase58()})`);
        return true;
    } catch (err: any) {
        console.error("Error checking actor existence on Solana:", err);
        throw new Error(`Failed to check actor existence: ${err.message || err.toString()}`);
    }
};

/**
 * Get actor account details from Solana
 * @param actorId The actor ID to fetch (number or string - BN handles both)
 * @returns Actor account data or null if not found
 */
export const getActorFromSolana = async (actorId: number | string): Promise<any | null> => {
    try {
        // Convert actorId to BN (handles both string and number)
        const actorIdBN = new BN(actorId);
        
        // PDA for actor account (seeds: "actor", authority, actor_id)
        const [actorPDA] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("actor"),
                feePayer.publicKey.toBuffer(),
                Buffer.from(actorIdBN.toArray("le", 8)),
            ],
            PROGRAM_ID
        );

        // Try to fetch the actor account
        // Anchor converts PascalCase struct names to camelCase: ActorAccount -> actorAccount
        // Field names are also converted: actor_id -> actorId, name_len -> nameLen
        try {
            const actorAccount = await (program.account as any).actorAccount.fetch(actorPDA);
            
            return {
                actor_id: actorAccount.actorId.toString(), // Use toString() to prevent precision loss
                user_id: actorAccount.userId.toString(), // Use toString() to prevent precision loss
                name: Buffer.from(actorAccount.name.slice(0, actorAccount.nameLen)).toString('utf8'),
                actor_type: actorAccount.actorType,
                roles: Buffer.from(actorAccount.roles.slice(0, actorAccount.rolesLen)).toString('utf8'),
                organization: actorAccount.organizationLen > 0 
                    ? Buffer.from(actorAccount.organization.slice(0, actorAccount.organizationLen)).toString('utf8')
                    : null,
                is_active: actorAccount.isActive === 1,
                province: Buffer.from(actorAccount.province.slice(0, actorAccount.provinceLen)).toString('utf8'),
                city: Buffer.from(actorAccount.city.slice(0, actorAccount.cityLen)).toString('utf8'),
                balance: actorAccount.balance.toString(), // Use toString() to prevent precision loss
                pin: Buffer.from(actorAccount.pin.slice(0, actorAccount.pinLen)).toString('utf8'),
                address: Buffer.from(actorAccount.address.slice(0, actorAccount.addressLen)).toString('utf8'),
                farm_id: Buffer.from(actorAccount.farmId.slice(0, actorAccount.farmIdLen)).toString('utf8'),
                farmer_id: actorAccount.farmerId.toString(), // Use toString() to prevent precision loss
                assigned_tps: actorAccount.assignedTps.toString(), // Use toString() to prevent precision loss
                timestamp: actorAccount.timestamp.toString(), // Use toString() to prevent precision loss
                pda: actorPDA.toBase58(),
            };
        } catch (fetchErr: any) {
            // Account doesn't exist or couldn't be decoded
            console.log(`Actor ${actorIdBN.toString()} account fetch failed:`, fetchErr.message);
            return null;
        }
    } catch (err: any) {
        console.error("Error fetching actor from Solana:", err);
        throw new Error(`Failed to fetch actor: ${err.message || err.toString()}`);
    }
};

/**
 * Update an existing actor on Solana
 * @param actorData Object containing actor_id and optional fields to update
 * @returns Transaction signature
 */
export const updateActorOnSolana = async (actorData: any): Promise<string> => {
    const {
        actor_id,
        name,
        roles,              // JSON string or array of roles
        organization,        // Optional organization (BLO, Buyback, COOP)
        is_active,
        province,
        city,
        balance,
        address,
        assigned_tps,
    } = actorData;

    // Parse roles - if it's a JSON string, parse it; if it's already an array, use it
    let rolesString: string | null = null;
    if (roles !== undefined && roles !== null) {
        if (typeof roles === 'string') {
            try {
                // Try to parse as JSON first
                const parsed = JSON.parse(roles);
                rolesString = Array.isArray(parsed) ? parsed.join(',') : roles;
            } catch {
                // If not JSON, assume it's already comma-separated
                rolesString = roles;
            }
        } else if (Array.isArray(roles)) {
            rolesString = roles.join(',');
        }
    }

    // Convert is_active boolean to u8 if provided
    let isActiveU8: number | null = null;
    if (is_active !== undefined && is_active !== null) {
        isActiveU8 = is_active ? 1 : 0;
    }

    // Convert balance to smallest unit if provided
    // Use string conversion to prevent precision loss with large numbers
    let balanceInSmallestUnit: BN | null = null;
    if (balance !== undefined && balance !== null) {
        // Convert balance to string first, then parse as decimal, multiply, and convert to BN
        const balanceStr = String(balance);
        const balanceNum = parseFloat(balanceStr);
        const smallestUnit = Math.floor(balanceNum * 100); // Assuming 2 decimal places
        balanceInSmallestUnit = new BN(String(smallestUnit), 10);
    }

    // ============================================
    // VALIDATE AND CONVERT actor_id
    // ============================================
    const actorIdBN = validateAndConvertActorId(actor_id, "update");

    // PDA for actor account (seeds: "actor", authority, actor_id)
    const [actorPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("actor"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(actorIdBN.toArray("le", 8)),
        ],
        PROGRAM_ID
    );

    try {
        // Verify the method exists
        if (!program.methods.updateActor) {
            console.error("Available methods:", Object.keys(program.methods));
            throw new Error("updateActor method not found in program. Available methods: " + Object.keys(program.methods).join(", "));
        }

        // Log the method signature for debugging
        console.log("updateActor method found. Program ID:", PROGRAM_ID.toBase58());
        console.log("Program IDL address:", program.idl.address);

        // First verify actor exists - CRITICAL: Do not create, only update existing actors
        const accountInfo = await connection.getAccountInfo(actorPDA);
        if (accountInfo === null) {
            console.error(`Actor ${actor_id} does not exist on Solana (PDA: ${actorPDA.toBase58()}). Cannot update non-existent actor.`);
            throw new Error(`Actor ${actor_id} does not exist on Solana. Cannot update non-existent actor. Use create_actor instruction instead.`);
        }
        
        // Verify it's owned by our program
        if (!accountInfo.owner.equals(PROGRAM_ID)) {
            console.error(`Actor ${actor_id} account exists but is not owned by our program`);
            throw new Error(`Actor ${actor_id} account exists but is not owned by the correct program.`);
        }

        // Prepare parameters with explicit null handling for Option types
        const params = [
            actorIdBN, // _actor_id: u64 (required, use validated BN)
            name !== undefined ? name : null, // name: Option<String>
            rolesString !== null ? rolesString : null, // roles: Option<String>
            organization !== undefined && organization !== null ? organization : null, // organization: Option<String>
            isActiveU8 !== null ? isActiveU8 : null, // is_active: Option<u8>
            province !== undefined ? province : null, // province: Option<String>
            city !== undefined ? city : null, // city: Option<String>
            balanceInSmallestUnit !== null ? balanceInSmallestUnit : null, // balance: Option<u64>
            address !== undefined ? address : null, // address: Option<String>
            assigned_tps !== undefined ? new BN(String(assigned_tps), 10) : null, // assigned_tps: Option<u64> (convert to string first)
        ];

        console.log("Calling updateActor with parameters:", {
            actor_id: params[0].toString(),
            name: params[1],
            roles: params[2],
            organization: params[3],
            is_active: params[4],
            province: params[5],
            city: params[6],
            balance: params[7] ? (params[7] instanceof BN ? params[7].toString() : params[7]) : null,
            address: params[8],
            assigned_tps: params[9] ? (params[9] instanceof BN ? params[9].toString() : params[9]) : null,
        });

        // Build the method call with optional parameters
        // Anchor's Option<T> in Rust maps to null in TypeScript
        // actor_id must be the first parameter for Anchor to derive the PDA correctly
        const methodBuilder = program.methods.updateActor(...params);

        const txSig = await methodBuilder
            .accounts({
                actor: actorPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        console.log("Actor Updated on Solana:", txSig);
        return txSig;
    } catch (err: any) {
        console.error("Anchor Program Update Call Failed:", err);
        console.error("Error details:", {
            message: err.message,
            stack: err.stack,
            name: err.name,
            cause: err.cause
        });
        throw new Error(`Failed to execute Anchor update instruction: ${err.message || err.toString()}`);
    }
};

export const deleteActorOnSolana = async (actorData: any): Promise<string> => {
    const { actor_id } = actorData;

    // ============================================
    // VALIDATE AND CONVERT actor_id
    // ============================================
    const actorIdBN = validateAndConvertActorId(actor_id, "deletion");

    // PDA for actor account (seeds: "actor", authority, actor_id)
    const [actorPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("actor"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(actorIdBN.toArray("le", 8)),
        ],
        PROGRAM_ID
    );

    try {
        // Verify the method exists
        if (!program.methods.deleteActor) {
            console.error("Available methods:", Object.keys(program.methods));
            throw new Error("deleteActor method not found in program. Available methods: " + Object.keys(program.methods).join(", "));
        }

        console.log("deleteActor method found. Program ID:", PROGRAM_ID.toBase58());

        // Verify actor exists before deletion
        const accountInfo = await connection.getAccountInfo(actorPDA);
        if (accountInfo === null) {
            console.error(`Actor ${actorIdBN.toString()} does not exist on Solana (PDA: ${actorPDA.toBase58()}). Cannot delete non-existent actor.`);
            throw new Error(`Actor ${actorIdBN.toString()} does not exist on Solana. Cannot delete non-existent actor.`);
        }
        
        // Verify it's owned by our program
        if (!accountInfo.owner.equals(PROGRAM_ID)) {
            console.error(`Actor ${actorIdBN.toString()} account exists but is not owned by our program`);
            throw new Error(`Actor ${actorIdBN.toString()} account exists but is not owned by the correct program.`);
        }

        console.log("Calling deleteActor with actor_id:", actorIdBN.toString());

        // Call delete_actor instruction (only requires actor_id for PDA derivation)
        const txSig = await program.methods
            .deleteActor(actorIdBN)
            .accounts({
                actor: actorPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        console.log("Actor Deleted (Deactivated) on Solana:", txSig);
        return txSig;
    } catch (err: any) {
        console.error("Anchor Program Delete Call Failed:", err);
        console.error("Error details:", {
            message: err.message,
            stack: err.stack,
            name: err.name,
            cause: err.cause
        });
        throw new Error(`Failed to execute Anchor delete instruction: ${err.message || err.toString()}`);
    }
};

/**
 * Close an actor account permanently (removes from blockchain, returns rent)
 * WARNING: This permanently deletes the account - use only for orphaned accounts
 * @param actorData Object containing actor_id
 * @returns Transaction signature
 */
export const closeActorOnSolana = async (actorData: any): Promise<string> => {
    const { actor_id } = actorData;

    // ============================================
    // VALIDATE AND CONVERT actor_id
    // ============================================
    const actorIdBN = validateAndConvertActorId(actor_id, "closing account");

    // PDA for actor account (seeds: "actor", authority, actor_id)
    const [actorPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("actor"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(actorIdBN.toArray("le", 8)),
        ],
        PROGRAM_ID
    );

    try {
        // Verify the method exists
        if (!program.methods.closeActor) {
            console.error("Available methods:", Object.keys(program.methods));
            throw new Error("closeActor method not found in program. Available methods: " + Object.keys(program.methods).join(", "));
        }

        console.log("closeActor method found. Program ID:", PROGRAM_ID.toBase58());

        // Verify actor exists before closing
        const accountInfo = await connection.getAccountInfo(actorPDA);
        if (accountInfo === null) {
            console.error(`Actor ${actorIdBN.toString()} does not exist on Solana (PDA: ${actorPDA.toBase58()}). Cannot close non-existent actor.`);
            throw new Error(`Actor ${actorIdBN.toString()} does not exist on Solana. Cannot close non-existent actor.`);
        }
        
        // Verify it's owned by our program
        if (!accountInfo.owner.equals(PROGRAM_ID)) {
            console.error(`Actor ${actorIdBN.toString()} account exists but is not owned by our program`);
            throw new Error(`Actor ${actorIdBN.toString()} account exists but is not owned by the correct program.`);
        }

        console.log("Calling closeActor with actor_id:", actorIdBN.toString());
        console.log("WARNING: This will permanently delete the account and return rent");

        // Call close_actor instruction (closes account and returns rent)
        const txSig = await program.methods
            .closeActor(actorIdBN)
            .accounts({
                actor: actorPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        console.log("Actor Account Closed on Solana (rent returned):", txSig);
        return txSig;
    } catch (err: any) {
        console.error("Anchor Program Close Call Failed:", err);
        console.error("Error details:", {
            message: err.message,
            stack: err.stack,
            name: err.name,
            cause: err.cause
        });
        throw new Error(`Failed to execute Anchor close instruction: ${err.message || err.toString()}`);
    }
};

// ============================================
// RICE BATCH FUNCTIONS
// ============================================

/**
 * Validate and convert batch_id to BN
 * Similar to validateAndConvertActorId but for batch operations
 */
function validateAndConvertBatchId(batch_id: any, operationName: string = "operation"): BN {
    if (batch_id === undefined || batch_id === null) {
        throw new Error(`batch_id is required for ${operationName}`);
    }

    const batchIdString = String(batch_id);
    
    if (!/^\d+$/.test(batchIdString)) {
        throw new Error(`Invalid batch_id format: ${batch_id}. Must be a valid u64 (numeric string)`);
    }
    
    let batchIdBN: BN;
    try {
        batchIdBN = new BN(batchIdString, 10);
    } catch (err) {
        throw new Error(`Invalid batch_id format: ${batch_id}. Must be a valid u64 (number or numeric string)`);
    }

    const MAX_U64 = new BN('18446744073709551615');
    if (batchIdBN.lt(new BN(0)) || batchIdBN.gt(MAX_U64)) {
        throw new Error(`batch_id out of range: ${batch_id}. Must be between 0 and 18446744073709551615`);
    }

    if (batchIdBN.eq(new BN(0))) {
        throw new Error(`batch_id cannot be 0. Invalid batch ID.`);
    }

    return batchIdBN;
}

/**
 * Submit a new rice batch to Solana
 * @param batchData Object containing batch data
 * @returns Transaction signature
 */
export const submitBatchToSolana = async (batchData: any): Promise<string> => {
    const {
        batch_id,
        qr_code,
        season_id,
        current_holder_id,
        milling_id,
        drying_id,
        validator,
        batch_weight_kg,
        moisture_content,
        price_per_kg,
        status,
    } = batchData;

    // Validate batch_id
    const batchIdBN = validateAndConvertBatchId(batch_id, "creation");

    // Convert status string to u8
    const statusMap: { [key: string]: number } = {
        'for_sale': 0,
        'stock': 1,
        'consumed': 2,
    };
    const statusU8 = statusMap[status] ?? 1; // Default to 'stock'

    // Convert decimal values to integers for Solana storage
    // Weight: kg to grams (multiply by 1000)
    const weightInGrams = Math.floor((batch_weight_kg || 0) * 1000);
    
    // Moisture: percentage to basis points (multiply by 100)
    const moistureBasisPoints = Math.floor((moisture_content || 0) * 100);
    
    // Price: to cents (multiply by 100)
    const priceInCents = Math.floor((price_per_kg || 0) * 100);

    // Derive PDA
    let batchPDA: PublicKey;
    let bump: number;
    
    try {
        [batchPDA, bump] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("batch"),
                feePayer.publicKey.toBuffer(),
                Buffer.from(batchIdBN.toArray("le", 8)),
            ],
            PROGRAM_ID
        );

        console.log("Batch PDA Derivation:", {
            batch_id: batchIdBN.toString(),
            pda: batchPDA.toBase58(),
            bump: bump,
        });
        
        // Check if account already exists
        const accountInfo = await connection.getAccountInfo(batchPDA);
        if (accountInfo !== null) {
            throw new Error(
                `Batch account already exists on Solana. ` +
                `Batch ID: ${batchIdBN.toString()}, PDA: ${batchPDA.toBase58()}.`
            );
        }
    } catch (pdaErr: any) {
        if (pdaErr.message?.includes('already exists')) {
            throw pdaErr;
        }
        throw new Error(`Failed to derive PDA for batch_id ${batchIdBN.toString()}: ${pdaErr.message}`);
    }

    try {
        if (!program.methods.createBatch) {
            console.error("Available methods:", Object.keys(program.methods));
            throw new Error("createBatch method not found in program. Available methods: " + Object.keys(program.methods).join(", "));
        }

        console.log("Calling createBatch with data:", {
            batch_id: batchIdBN.toString(),
            qr_code,
            season_id,
            current_holder_id,
            milling_id,
            drying_id,
            validator,
            batch_weight_kg: weightInGrams,
            moisture_content: moistureBasisPoints,
            price_per_kg: priceInCents,
            status: statusU8,
        });

        const txSig = await program.methods
            .createBatch(
                batchIdBN,
                qr_code || "",
                new BN(String(season_id || 0), 10),
                new BN(String(current_holder_id || 0), 10),
                milling_id ? new BN(String(milling_id), 10) : null,
                drying_id ? new BN(String(drying_id), 10) : null,
                validator ? new BN(String(validator), 10) : null,
                new BN(String(weightInGrams), 10),
                new BN(String(moistureBasisPoints), 10),
                new BN(String(priceInCents), 10),
                statusU8
            )
            .accounts({
                batch: batchPDA,
                authority: wallet.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([feePayer])
            .rpc();

        console.log("Batch Created on Solana:", txSig);
        return txSig;
    } catch (err: any) {
        console.error("Anchor Program createBatch Failed:", err);
        console.error("Error details:", {
            message: err.message,
            stack: err.stack,
            name: err.name,
            cause: err.cause
        });
        throw new Error(`Failed to execute Anchor createBatch instruction: ${err.message || err.toString()}`);
    }
};

/**
 * Check if a batch account exists on Solana
 * @param batchId The batch ID to check
 * @returns true if batch exists, false otherwise
 */
export const checkBatchExistsOnSolana = async (batchId: number | string): Promise<boolean> => {
    try {
        const batchIdString = String(batchId);
        
        if (!/^\d+$/.test(batchIdString)) {
            throw new Error(`Invalid batch_id format: ${batchId}. Must be a valid u64 (numeric string)`);
        }
        
        const batchIdBN = new BN(batchIdString, 10);
        
        const [batchPDA] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("batch"),
                feePayer.publicKey.toBuffer(),
                Buffer.from(batchIdBN.toArray("le", 8)),
            ],
            PROGRAM_ID
        );

        const accountInfo = await connection.getAccountInfo(batchPDA);
        
        if (accountInfo === null) {
            console.log(`Batch ${batchIdBN.toString()} does not exist on Solana (PDA: ${batchPDA.toBase58()})`);
            return false;
        }

        if (!accountInfo.owner.equals(PROGRAM_ID)) {
            console.warn(`Batch ${batchIdBN.toString()} account exists but is not owned by our program`);
            return false;
        }

        console.log(`Batch ${batchIdBN.toString()} exists on Solana (PDA: ${batchPDA.toBase58()})`);
        return true;
    } catch (err: any) {
        console.error("Error checking batch existence on Solana:", err);
        throw new Error(`Failed to check batch existence: ${err.message || err.toString()}`);
    }
};

/**
 * Get batch account details from Solana
 * @param batchId The batch ID to fetch
 * @returns Batch account data or null if not found
 */
export const getBatchFromSolana = async (batchId: number | string): Promise<any | null> => {
    try {
        const batchIdBN = new BN(String(batchId), 10);
        
        const [batchPDA] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("batch"),
                feePayer.publicKey.toBuffer(),
                Buffer.from(batchIdBN.toArray("le", 8)),
            ],
            PROGRAM_ID
        );

        try {
            const batchAccount = await (program.account as any).batchAccount.fetch(batchPDA);
            
            // Convert status back to string
            const statusMap: { [key: number]: string } = {
                0: 'for_sale',
                1: 'stock',
                2: 'consumed',
            };

            return {
                batch_id: batchAccount.batchId.toString(),
                qr_code: Buffer.from(batchAccount.qrCode.slice(0, batchAccount.qrCodeLen)).toString('utf8'),
                season_id: batchAccount.seasonId.toString(),
                current_holder_id: batchAccount.currentHolderId.toString(),
                milling_id: batchAccount.millingId.toString(),
                drying_id: batchAccount.dryingId.toString(),
                validator: batchAccount.validator.toString(),
                batch_weight_kg: batchAccount.batchWeightKg.toNumber() / 1000, // Convert grams back to kg
                moisture_content: batchAccount.moistureContent.toNumber() / 100, // Convert basis points to percentage
                price_per_kg: batchAccount.pricePerKg.toNumber() / 100, // Convert cents to currency
                status: statusMap[batchAccount.status] || 'stock',
                is_active: batchAccount.isActive === 1,
                timestamp: batchAccount.timestamp.toString(),
                pda: batchPDA.toBase58(),
            };
        } catch (fetchErr: any) {
            console.log(`Batch ${batchIdBN.toString()} account fetch failed:`, fetchErr.message);
            return null;
        }
    } catch (err: any) {
        console.error("Error fetching batch from Solana:", err);
        throw new Error(`Failed to fetch batch: ${err.message || err.toString()}`);
    }
};

/**
 * Update an existing batch on Solana
 * @param batchData Object containing batch_id and optional fields to update
 * @returns Transaction signature
 */
export const updateBatchOnSolana = async (batchData: any): Promise<string> => {
    const {
        batch_id,
        current_holder_id,
        milling_id,
        drying_id,
        validator,
        batch_weight_kg,
        moisture_content,
        price_per_kg,
        status,
    } = batchData;

    const batchIdBN = validateAndConvertBatchId(batch_id, "update");

    const [batchPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("batch"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(batchIdBN.toArray("le", 8)),
        ],
        PROGRAM_ID
    );

    try {
        if (!program.methods.updateBatch) {
            console.error("Available methods:", Object.keys(program.methods));
            throw new Error("updateBatch method not found in program. Available methods: " + Object.keys(program.methods).join(", "));
        }

        // Verify batch exists
        const accountInfo = await connection.getAccountInfo(batchPDA);
        if (accountInfo === null) {
            throw new Error(`Batch ${batch_id} does not exist on Solana. Cannot update non-existent batch.`);
        }
        
        if (!accountInfo.owner.equals(PROGRAM_ID)) {
            throw new Error(`Batch ${batch_id} account exists but is not owned by the correct program.`);
        }

        // Convert status string to u8 if provided
        let statusU8: number | null = null;
        if (status !== undefined && status !== null) {
            const statusMap: { [key: string]: number } = {
                'for_sale': 0,
                'stock': 1,
                'consumed': 2,
            };
            statusU8 = statusMap[status] ?? null;
        }

        // Convert decimal values if provided
        const weightInGrams = batch_weight_kg !== undefined ? Math.floor(batch_weight_kg * 1000) : null;
        const moistureBasisPoints = moisture_content !== undefined ? Math.floor(moisture_content * 100) : null;
        const priceInCents = price_per_kg !== undefined ? Math.floor(price_per_kg * 100) : null;

        const params = [
            batchIdBN,
            current_holder_id !== undefined ? new BN(String(current_holder_id), 10) : null,
            milling_id !== undefined ? new BN(String(milling_id), 10) : null,
            drying_id !== undefined ? new BN(String(drying_id), 10) : null,
            validator !== undefined ? new BN(String(validator), 10) : null,
            weightInGrams !== null ? new BN(String(weightInGrams), 10) : null,
            moistureBasisPoints !== null ? new BN(String(moistureBasisPoints), 10) : null,
            priceInCents !== null ? new BN(String(priceInCents), 10) : null,
            statusU8,
        ];

        console.log("Calling updateBatch with parameters:", {
            batch_id: batchIdBN.toString(),
            current_holder_id: params[1]?.toString() || null,
            milling_id: params[2]?.toString() || null,
            drying_id: params[3]?.toString() || null,
            validator: params[4]?.toString() || null,
            batch_weight_kg: params[5]?.toString() || null,
            moisture_content: params[6]?.toString() || null,
            price_per_kg: params[7]?.toString() || null,
            status: params[8],
        });

        const txSig = await program.methods
            .updateBatch(...params)
            .accounts({
                batch: batchPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        console.log("Batch Updated on Solana:", txSig);
        return txSig;
    } catch (err: any) {
        console.error("Anchor Program updateBatch Failed:", err);
        console.error("Error details:", {
            message: err.message,
            stack: err.stack,
            name: err.name,
            cause: err.cause
        });
        throw new Error(`Failed to execute Anchor updateBatch instruction: ${err.message || err.toString()}`);
    }
};

/**
 * Soft delete a batch on Solana (set is_active = 0)
 * @param batchData Object containing batch_id
 * @returns Transaction signature
 */
export const deleteBatchOnSolana = async (batchData: any): Promise<string> => {
    const { batch_id } = batchData;

    const batchIdBN = validateAndConvertBatchId(batch_id, "deletion");

    const [batchPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("batch"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(batchIdBN.toArray("le", 8)),
        ],
        PROGRAM_ID
    );

    try {
        if (!program.methods.deleteBatch) {
            console.error("Available methods:", Object.keys(program.methods));
            throw new Error("deleteBatch method not found in program. Available methods: " + Object.keys(program.methods).join(", "));
        }

        // Verify batch exists
        const accountInfo = await connection.getAccountInfo(batchPDA);
        if (accountInfo === null) {
            throw new Error(`Batch ${batchIdBN.toString()} does not exist on Solana. Cannot delete non-existent batch.`);
        }
        
        if (!accountInfo.owner.equals(PROGRAM_ID)) {
            throw new Error(`Batch ${batchIdBN.toString()} account exists but is not owned by the correct program.`);
        }

        console.log("Calling deleteBatch with batch_id:", batchIdBN.toString());

        const txSig = await program.methods
            .deleteBatch(batchIdBN)
            .accounts({
                batch: batchPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        console.log("Batch Deleted (Deactivated) on Solana:", txSig);
        return txSig;
    } catch (err: any) {
        console.error("Anchor Program deleteBatch Failed:", err);
        console.error("Error details:", {
            message: err.message,
            stack: err.stack,
            name: err.name,
            cause: err.cause
        });
        throw new Error(`Failed to execute Anchor deleteBatch instruction: ${err.message || err.toString()}`);
    }
};

/**
 * Close a batch account permanently (removes from blockchain, returns rent)
 * WARNING: This permanently deletes the account
 * @param batchData Object containing batch_id
 * @returns Transaction signature
 */
export const closeBatchOnSolana = async (batchData: any): Promise<string> => {
    const { batch_id } = batchData;

    const batchIdBN = validateAndConvertBatchId(batch_id, "closing account");

    const [batchPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("batch"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(batchIdBN.toArray("le", 8)),
        ],
        PROGRAM_ID
    );

    try {
        if (!program.methods.closeBatch) {
            console.error("Available methods:", Object.keys(program.methods));
            throw new Error("closeBatch method not found in program. Available methods: " + Object.keys(program.methods).join(", "));
        }

        // Verify batch exists
        const accountInfo = await connection.getAccountInfo(batchPDA);
        if (accountInfo === null) {
            throw new Error(`Batch ${batchIdBN.toString()} does not exist on Solana. Cannot close non-existent batch.`);
        }
        
        if (!accountInfo.owner.equals(PROGRAM_ID)) {
            throw new Error(`Batch ${batchIdBN.toString()} account exists but is not owned by the correct program.`);
        }

        console.log("Calling closeBatch with batch_id:", batchIdBN.toString());
        console.log("WARNING: This will permanently delete the account and return rent");

        const txSig = await program.methods
            .closeBatch(batchIdBN)
            .accounts({
                batch: batchPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        console.log("Batch Account Closed on Solana (rent returned):", txSig);
        return txSig;
    } catch (err: any) {
        console.error("Anchor Program closeBatch Failed:", err);
        console.error("Error details:", {
            message: err.message,
            stack: err.stack,
            name: err.name,
            cause: err.cause
        });
        throw new Error(`Failed to execute Anchor closeBatch instruction: ${err.message || err.toString()}`);
    }
};

// ============================================
// DRYING PROCESS FUNCTIONS
// ============================================

/**
 * Helper to validate and convert drying_id to BN
 */
const validateAndConvertDryingId = (drying_id: any, operation: string): BN => {
    if (drying_id === undefined || drying_id === null) {
        throw new Error(`Missing drying_id for ${operation}`);
    }
    
    let dryingIdBN: BN;
    if (typeof drying_id === 'string') {
        dryingIdBN = new BN(drying_id);
    } else if (typeof drying_id === 'number') {
        dryingIdBN = new BN(drying_id);
    } else if (BN.isBN(drying_id)) {
        dryingIdBN = drying_id;
    } else {
        throw new Error(`Invalid drying_id type for ${operation}: ${typeof drying_id}`);
    }
    
    if (dryingIdBN.isNeg()) {
        throw new Error(`drying_id must be positive for ${operation}`);
    }
    
    return dryingIdBN;
};

/**
 * Submit a new drying record to Solana
 * @param dryingData Object containing drying fields
 * @returns Transaction signature
 */
export const submitDryingToSolana = async (dryingData: any): Promise<string> => {
    const {
        drying_id,
        batch_id,
        dryer_actor_id,
        initial_mc,
        final_mc,
        temperature,
        airflow,
        humidity,
        duration,
        price,
        initial_weight,
        final_weight
    } = dryingData;

    const dryingIdBN = validateAndConvertDryingId(drying_id, "submission");

    const [dryingPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("drying"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(dryingIdBN.toArray("le", 8)),
        ],
        PROGRAM_ID
    );

    // Convert values to BN (Solana uses u64 for numeric fields)
    // Moisture content: stored as basis points (22.5% = 2250)
    // Temperature: stored * 100 (45.5°C = 4550)
    // Airflow: stored * 100
    // Humidity: stored as basis points
    // Duration: stored in minutes
    // Price: stored in cents
    // Weights: stored in grams
    const batchIdBN = new BN(batch_id || 0);
    const dryerActorIdBN = new BN(dryer_actor_id || 0);
    const initialMcBN = new BN(Math.round((initial_mc || 0) * 100));
    const finalMcBN = new BN(Math.round((final_mc || 0) * 100));
    const temperatureBN = new BN(Math.round((temperature || 0) * 100));
    const airflowBN = new BN(Math.round((airflow || 0) * 100));
    const humidityBN = new BN(Math.round((humidity || 0) * 100));
    const durationBN = new BN(Math.round((duration || 0) * 60)); // Convert hours to minutes
    const priceBN = new BN(Math.round((price || 0) * 100)); // Convert to cents
    const initialWeightBN = new BN(Math.round((initial_weight || 0) * 1000)); // Convert kg to grams
    const finalWeightBN = new BN(Math.round((final_weight || 0) * 1000)); // Convert kg to grams

    try {
        if (!program.methods.createDrying) {
            console.error("Available methods:", Object.keys(program.methods));
            throw new Error("createDrying method not found in program. Available methods: " + Object.keys(program.methods).join(", "));
        }

        console.log("Calling createDrying with drying_id:", dryingIdBN.toString());
        console.log("Drying payload:", {
            drying_id: dryingIdBN.toString(),
            batch_id: batchIdBN.toString(),
            dryer_actor_id: dryerActorIdBN.toString(),
            initial_mc: initialMcBN.toString(),
            final_mc: finalMcBN.toString(),
        });

        const txSig = await program.methods
            .createDrying(
                dryingIdBN,
                batchIdBN,
                dryerActorIdBN,
                initialMcBN,
                finalMcBN,
                temperatureBN,
                airflowBN,
                humidityBN,
                durationBN,
                priceBN,
                initialWeightBN,
                finalWeightBN
            )
            .accounts({
                drying: dryingPDA,
                authority: wallet.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([feePayer])
            .rpc();

        console.log("Drying Submitted to Solana:", txSig);
        return txSig;
    } catch (err: any) {
        console.error("Anchor Program createDrying Failed:", err);
        console.error("Error details:", {
            message: err.message,
            stack: err.stack,
            name: err.name,
            cause: err.cause
        });
        throw new Error(`Failed to execute Anchor createDrying instruction: ${err.message || err.toString()}`);
    }
};

/**
 * Check if a drying record exists on Solana
 * @param dryingId The drying ID to check
 * @returns Object with exists flag and optional account data
 */
export const checkDryingExistsOnSolana = async (dryingId: any): Promise<{ exists: boolean; pda?: string; accountData?: any }> => {
    const dryingIdBN = validateAndConvertDryingId(dryingId, "existence check");

    const [dryingPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("drying"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(dryingIdBN.toArray("le", 8)),
        ],
        PROGRAM_ID
    );

    try {
        const accountInfo = await connection.getAccountInfo(dryingPDA);

        if (accountInfo === null) {
            return { exists: false };
        }

        if (!accountInfo.owner.equals(PROGRAM_ID)) {
            return { exists: false };
        }

        return {
            exists: true,
            pda: dryingPDA.toBase58()
        };
    } catch (err: any) {
        console.error("Error checking drying existence:", err);
        return { exists: false };
    }
};

/**
 * Get a drying record from Solana
 * @param dryingId The drying ID to fetch
 * @returns Drying account data
 */
export const getDryingFromSolana = async (dryingId: any): Promise<any> => {
    const dryingIdBN = validateAndConvertDryingId(dryingId, "fetch");

    const [dryingPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("drying"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(dryingIdBN.toArray("le", 8)),
        ],
        PROGRAM_ID
    );

    try {
        const dryingAccount = await (program.account as any).dryingAccount.fetch(dryingPDA);
        
        return {
            drying_id: dryingAccount.dryingId.toString(),
            batch_id: dryingAccount.batchId.toString(),
            dryer_actor_id: dryingAccount.dryerActorId.toString(),
            initial_mc: dryingAccount.initialMc.toNumber() / 100,
            final_mc: dryingAccount.finalMc.toNumber() / 100,
            temperature: dryingAccount.temperature.toNumber() / 100,
            airflow: dryingAccount.airflow.toNumber() / 100,
            humidity: dryingAccount.humidity.toNumber() / 100,
            duration: dryingAccount.duration.toNumber() / 60, // Convert minutes back to hours
            price: dryingAccount.price.toNumber() / 100,
            initial_weight: dryingAccount.initialWeight.toNumber() / 1000, // Convert grams back to kg
            final_weight: dryingAccount.finalWeight.toNumber() / 1000,
            is_active: dryingAccount.isActive === 1,
            timestamp: dryingAccount.timestamp.toNumber(),
            pda: dryingPDA.toBase58()
        };
    } catch (err: any) {
        console.error("Error fetching drying from Solana:", err);
        throw new Error(`Failed to fetch drying ${dryingIdBN.toString()} from Solana: ${err.message}`);
    }
};

/**
 * Update a drying record on Solana
 * @param dryingData Object containing drying_id and fields to update
 * @returns Transaction signature
 */
export const updateDryingOnSolana = async (dryingData: any): Promise<string> => {
    const { drying_id, ...updateFields } = dryingData;

    const dryingIdBN = validateAndConvertDryingId(drying_id, "update");

    const [dryingPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("drying"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(dryingIdBN.toArray("le", 8)),
        ],
        PROGRAM_ID
    );

    // Convert optional fields to BN or null
    const initialMc = updateFields.initial_mc !== undefined 
        ? new BN(Math.round(updateFields.initial_mc * 100)) : null;
    const finalMc = updateFields.final_mc !== undefined 
        ? new BN(Math.round(updateFields.final_mc * 100)) : null;
    const temperature = updateFields.temperature !== undefined 
        ? new BN(Math.round(updateFields.temperature * 100)) : null;
    const airflow = updateFields.airflow !== undefined 
        ? new BN(Math.round(updateFields.airflow * 100)) : null;
    const humidity = updateFields.humidity !== undefined 
        ? new BN(Math.round(updateFields.humidity * 100)) : null;
    const duration = updateFields.duration !== undefined 
        ? new BN(Math.round(updateFields.duration * 60)) : null;
    const price = updateFields.price !== undefined 
        ? new BN(Math.round(updateFields.price * 100)) : null;
    const initialWeight = updateFields.initial_weight !== undefined 
        ? new BN(Math.round(updateFields.initial_weight * 1000)) : null;
    const finalWeight = updateFields.final_weight !== undefined 
        ? new BN(Math.round(updateFields.final_weight * 1000)) : null;

    try {
        if (!program.methods.updateDrying) {
            console.error("Available methods:", Object.keys(program.methods));
            throw new Error("updateDrying method not found in program. Available methods: " + Object.keys(program.methods).join(", "));
        }

        // Verify drying exists
        const accountInfo = await connection.getAccountInfo(dryingPDA);
        if (accountInfo === null) {
            throw new Error(`Drying ${dryingIdBN.toString()} does not exist on Solana. Cannot update non-existent drying.`);
        }

        console.log("Calling updateDrying with drying_id:", dryingIdBN.toString());

        const txSig = await program.methods
            .updateDrying(
                dryingIdBN,
                initialMc,
                finalMc,
                temperature,
                airflow,
                humidity,
                duration,
                price,
                initialWeight,
                finalWeight
            )
            .accounts({
                drying: dryingPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        console.log("Drying Updated on Solana:", txSig);
        return txSig;
    } catch (err: any) {
        console.error("Anchor Program updateDrying Failed:", err);
        throw new Error(`Failed to execute Anchor updateDrying instruction: ${err.message || err.toString()}`);
    }
};

/**
 * Soft delete a drying record on Solana (set is_active = 0)
 * @param dryingData Object containing drying_id
 * @returns Transaction signature
 */
export const deleteDryingOnSolana = async (dryingData: any): Promise<string> => {
    const { drying_id } = dryingData;

    const dryingIdBN = validateAndConvertDryingId(drying_id, "deletion");

    const [dryingPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("drying"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(dryingIdBN.toArray("le", 8)),
        ],
        PROGRAM_ID
    );

    try {
        if (!program.methods.deleteDrying) {
            console.error("Available methods:", Object.keys(program.methods));
            throw new Error("deleteDrying method not found in program. Available methods: " + Object.keys(program.methods).join(", "));
        }

        // Verify drying exists
        const accountInfo = await connection.getAccountInfo(dryingPDA);
        if (accountInfo === null) {
            throw new Error(`Drying ${dryingIdBN.toString()} does not exist on Solana. Cannot delete non-existent drying.`);
        }

        console.log("Calling deleteDrying with drying_id:", dryingIdBN.toString());

        const txSig = await program.methods
            .deleteDrying(dryingIdBN)
            .accounts({
                drying: dryingPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        console.log("Drying Deleted (Deactivated) on Solana:", txSig);
        return txSig;
    } catch (err: any) {
        console.error("Anchor Program deleteDrying Failed:", err);
        throw new Error(`Failed to execute Anchor deleteDrying instruction: ${err.message || err.toString()}`);
    }
};

/**
 * Close a drying account permanently (removes from blockchain, returns rent)
 * WARNING: This permanently deletes the account
 * @param dryingData Object containing drying_id
 * @returns Transaction signature
 */
export const closeDryingOnSolana = async (dryingData: any): Promise<string> => {
    const { drying_id } = dryingData;

    const dryingIdBN = validateAndConvertDryingId(drying_id, "closing account");

    const [dryingPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("drying"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(dryingIdBN.toArray("le", 8)),
        ],
        PROGRAM_ID
    );

    try {
        if (!program.methods.closeDrying) {
            console.error("Available methods:", Object.keys(program.methods));
            throw new Error("closeDrying method not found in program. Available methods: " + Object.keys(program.methods).join(", "));
        }

        // Verify drying exists
        const accountInfo = await connection.getAccountInfo(dryingPDA);
        if (accountInfo === null) {
            throw new Error(`Drying ${dryingIdBN.toString()} does not exist on Solana. Cannot close non-existent drying.`);
        }

        console.log("Calling closeDrying with drying_id:", dryingIdBN.toString());
        console.log("WARNING: This will permanently delete the account and return rent");

        const txSig = await program.methods
            .closeDrying(dryingIdBN)
            .accounts({
                drying: dryingPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        console.log("Drying Account Closed on Solana (rent returned):", txSig);
        return txSig;
    } catch (err: any) {
        console.error("Anchor Program closeDrying Failed:", err);
        throw new Error(`Failed to execute Anchor closeDrying instruction: ${err.message || err.toString()}`);
    }
};

// ============================================
// MILLING FUNCTIONS
// ============================================

/**
 * Helper to validate and convert milling_id to BN
 */
const validateAndConvertMillingId = (milling_id: any, operation: string): BN => {
    if (milling_id === undefined || milling_id === null) {
        throw new Error(`Missing milling_id for ${operation}`);
    }
    
    let millingIdBN: BN;
    if (typeof milling_id === 'string') {
        millingIdBN = new BN(milling_id);
    } else if (typeof milling_id === 'number') {
        millingIdBN = new BN(milling_id);
    } else if (BN.isBN(milling_id)) {
        millingIdBN = milling_id;
    } else {
        throw new Error(`Invalid milling_id type for ${operation}: ${typeof milling_id}`);
    }
    
    if (millingIdBN.isNeg()) {
        throw new Error(`milling_id must be positive for ${operation}`);
    }
    
    return millingIdBN;
};

/**
 * Submit a new milling record to Solana
 * @param millingData Object containing milling details
 * @returns Transaction signature
 */
export const submitMillingToSolana = async (millingData: any): Promise<string> => {
    const {
        milling_id,
        miller_id,      // farmer_id from MySQL
        batch_id,       // Primary batch ID (first from batch_ids array)
        milling_type,
        quality,
        total_weight_kg,
        total_weight_processed_kg,
        recovery,
        moisture,
        price,
        actual_price
    } = millingData;

    const millingIdBN = validateAndConvertMillingId(milling_id, "submission");

    const [millingPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("milling"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(millingIdBN.toArray("le", 8)),
        ],
        PROGRAM_ID
    );

    // Convert values to BN (Solana uses u64 for numeric fields)
    const millerIdBN = new BN(miller_id || 0);
    const batchIdBN = new BN(batch_id || 0);
    // Weight: stored in grams (1000 kg = 1000000 grams) - handle string input
    const totalWeightKgNum = typeof total_weight_kg === 'string' ? parseFloat(total_weight_kg) : (total_weight_kg || 0);
    const totalWeightKgBN = new BN(Math.round(totalWeightKgNum * 1000));
    const totalWeightProcessedKgBN = new BN(Math.round((total_weight_processed_kg || 0) * 1000));
    // Recovery: stored as basis points (75.5% = 7550)
    const recoveryBN = new BN(Math.round((recovery || 0) * 100));
    // Moisture: stored as basis points (12.5% = 1250)
    const moistureBN = new BN(Math.round((moisture || 0) * 100));
    // Price: stored in cents
    const priceBN = new BN(Math.round((price || 0) * 100));
    const actualPriceBN = new BN(Math.round((actual_price || 0) * 100));

    try {
        if (!program.methods.createMilling) {
            console.error("Available methods:", Object.keys(program.methods));
            throw new Error("createMilling method not found in program. Available methods: " + Object.keys(program.methods).join(", "));
        }

        console.log("Calling createMilling with milling_id:", millingIdBN.toString());
        console.log("Milling payload:", {
            milling_id: millingIdBN.toString(),
            miller_id: millerIdBN.toString(),
            batch_id: batchIdBN.toString(),
            milling_type: milling_type || '',
            quality: quality || '',
            total_weight_kg: totalWeightKgBN.toString(),
            total_weight_processed_kg: totalWeightProcessedKgBN.toString(),
        });

        const txSig = await program.methods
            .createMilling(
                millingIdBN,
                millerIdBN,
                batchIdBN,
                milling_type || '',
                quality || '',
                totalWeightKgBN,
                totalWeightProcessedKgBN,
                recoveryBN,
                moistureBN,
                priceBN,
                actualPriceBN
            )
            .accounts({
                milling: millingPDA,
                authority: wallet.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([feePayer])
            .rpc();

        console.log("Milling Submitted to Solana:", txSig);
        return txSig;
    } catch (err: any) {
        console.error("Anchor Program createMilling Failed:", err);
        console.error("Error details:", {
            message: err.message,
            stack: err.stack,
            name: err.name,
            cause: err.cause
        });
        throw new Error(`Failed to execute Anchor createMilling instruction: ${err.message || err.toString()}`);
    }
};

/**
 * Check if a milling record exists on Solana
 * @param millingId The milling ID to check
 * @returns Object with exists flag and optional account data
 */
export const checkMillingExistsOnSolana = async (millingId: any): Promise<{ exists: boolean; pda?: string; accountData?: any }> => {
    const millingIdBN = validateAndConvertMillingId(millingId, "existence check");

    const [millingPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("milling"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(millingIdBN.toArray("le", 8)),
        ],
        PROGRAM_ID
    );

    try {
        const accountInfo = await connection.getAccountInfo(millingPDA);

        if (accountInfo === null) {
            return { exists: false };
        }

        if (!accountInfo.owner.equals(PROGRAM_ID)) {
            return { exists: false };
        }

        return {
            exists: true,
            pda: millingPDA.toBase58()
        };
    } catch (err: any) {
        console.error("Error checking milling existence:", err);
        return { exists: false };
    }
};

/**
 * Get a milling record from Solana
 * @param millingId The milling ID to fetch
 * @returns Milling account data
 */
export const getMillingFromSolana = async (millingId: any): Promise<any> => {
    const millingIdBN = validateAndConvertMillingId(millingId, "fetch");

    const [millingPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("milling"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(millingIdBN.toArray("le", 8)),
        ],
        PROGRAM_ID
    );

    try {
        const millingAccount = await (program.account as any).millingAccount.fetch(millingPDA);
        
        // Decode milling_type from buffer
        const millingTypeBytes = millingAccount.millingType.slice(0, millingAccount.millingTypeLen);
        const millingType = Buffer.from(millingTypeBytes).toString('utf8');
        
        // Decode quality from buffer
        const qualityBytes = millingAccount.quality.slice(0, millingAccount.qualityLen);
        const quality = Buffer.from(qualityBytes).toString('utf8');
        
        return {
            milling_id: millingAccount.millingId.toString(),
            miller_id: millingAccount.millerId.toString(),
            batch_id: millingAccount.batchId.toString(),
            milling_type: millingType,
            quality: quality,
            total_weight_kg: millingAccount.totalWeightKg.toNumber() / 1000, // Convert grams back to kg
            total_weight_processed_kg: millingAccount.totalWeightProcessedKg.toNumber() / 1000,
            recovery: millingAccount.recovery.toNumber() / 100,
            moisture: millingAccount.moisture.toNumber() / 100,
            price: millingAccount.price.toNumber() / 100,
            actual_price: millingAccount.actualPrice.toNumber() / 100,
            is_active: millingAccount.isActive === 1,
            timestamp: millingAccount.timestamp.toNumber(),
            pda: millingPDA.toBase58()
        };
    } catch (err: any) {
        console.error("Error fetching milling from Solana:", err);
        throw new Error(`Failed to fetch milling ${millingIdBN.toString()} from Solana: ${err.message}`);
    }
};

/**
 * Update a milling record on Solana
 * Uses sentinel values: u64::MAX = no update, empty string = no update
 * @param millingData Object containing milling_id and fields to update
 * @returns Transaction signature
 */
export const updateMillingOnSolana = async (millingData: any): Promise<string> => {
    const { milling_id, ...updateFields } = millingData;

    const millingIdBN = validateAndConvertMillingId(milling_id, "update");

    const [millingPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("milling"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(millingIdBN.toArray("le", 8)),
        ],
        PROGRAM_ID
    );

    // Use sentinel values for fields not being updated
    const U64_MAX = new BN("18446744073709551615"); // u64::MAX
    
    // String fields: empty string = no update
    const millingType = updateFields.milling_type !== undefined ? (updateFields.milling_type || '') : '';
    const quality = updateFields.quality !== undefined ? (updateFields.quality || '') : '';
    
    // Numeric fields: u64::MAX = no update
    let totalWeightKgBN = U64_MAX;
    if (updateFields.total_weight_kg !== undefined) {
        const totalWeightKgNum = typeof updateFields.total_weight_kg === 'string' 
            ? parseFloat(updateFields.total_weight_kg) 
            : updateFields.total_weight_kg;
        totalWeightKgBN = new BN(Math.round(totalWeightKgNum * 1000));
    }
    
    let totalWeightProcessedKgBN = U64_MAX;
    if (updateFields.total_weight_processed_kg !== undefined) {
        totalWeightProcessedKgBN = new BN(Math.round(updateFields.total_weight_processed_kg * 1000));
    }
    
    let recoveryBN = U64_MAX;
    if (updateFields.recovery !== undefined) {
        recoveryBN = new BN(Math.round(updateFields.recovery * 100));
    }
    
    let moistureBN = U64_MAX;
    if (updateFields.moisture !== undefined) {
        moistureBN = new BN(Math.round(updateFields.moisture * 100));
    }
    
    let priceBN = U64_MAX;
    if (updateFields.price !== undefined) {
        priceBN = new BN(Math.round(updateFields.price * 100));
    }
    
    let actualPriceBN = U64_MAX;
    if (updateFields.actual_price !== undefined) {
        actualPriceBN = new BN(Math.round(updateFields.actual_price * 100));
    }

    try {
        if (!program.methods.updateMilling) {
            console.error("Available methods:", Object.keys(program.methods));
            throw new Error("updateMilling method not found in program. Available methods: " + Object.keys(program.methods).join(", "));
        }

        // Verify milling exists
        const accountInfo = await connection.getAccountInfo(millingPDA);
        if (accountInfo === null) {
            throw new Error(`Milling ${millingIdBN.toString()} does not exist on Solana. Cannot update non-existent milling.`);
        }

        console.log("Calling updateMilling with milling_id:", millingIdBN.toString());

        const txSig = await program.methods
            .updateMilling(
                millingIdBN,
                millingType,
                quality,
                totalWeightKgBN,
                totalWeightProcessedKgBN,
                recoveryBN,
                moistureBN,
                priceBN,
                actualPriceBN
            )
            .accounts({
                milling: millingPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        console.log("Milling Updated on Solana:", txSig);
        return txSig;
    } catch (err: any) {
        console.error("Anchor Program updateMilling Failed:", err);
        throw new Error(`Failed to execute Anchor updateMilling instruction: ${err.message || err.toString()}`);
    }
};

/**
 * Soft delete a milling record on Solana (set is_active = 0)
 * @param millingData Object containing milling_id
 * @returns Transaction signature
 */
export const deleteMillingOnSolana = async (millingData: any): Promise<string> => {
    const { milling_id } = millingData;

    const millingIdBN = validateAndConvertMillingId(milling_id, "deletion");

    const [millingPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("milling"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(millingIdBN.toArray("le", 8)),
        ],
        PROGRAM_ID
    );

    try {
        if (!program.methods.deleteMilling) {
            console.error("Available methods:", Object.keys(program.methods));
            throw new Error("deleteMilling method not found in program. Available methods: " + Object.keys(program.methods).join(", "));
        }

        // Verify milling exists
        const accountInfo = await connection.getAccountInfo(millingPDA);
        if (accountInfo === null) {
            throw new Error(`Milling ${millingIdBN.toString()} does not exist on Solana. Cannot delete non-existent milling.`);
        }

        console.log("Calling deleteMilling with milling_id:", millingIdBN.toString());

        const txSig = await program.methods
            .deleteMilling(millingIdBN)
            .accounts({
                milling: millingPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        console.log("Milling Deleted on Solana:", txSig);
        return txSig;
    } catch (err: any) {
        console.error("Anchor Program deleteMilling Failed:", err);
        throw new Error(`Failed to execute Anchor deleteMilling instruction: ${err.message || err.toString()}`);
    }
};

/**
 * Close a milling account on Solana (permanently remove and return rent)
 * WARNING: This permanently deletes the account - use with caution
 * @param millingData Object containing milling_id
 * @returns Transaction signature
 */
export const closeMillingOnSolana = async (millingData: any): Promise<string> => {
    const { milling_id } = millingData;

    const millingIdBN = validateAndConvertMillingId(milling_id, "closing account");

    const [millingPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("milling"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(millingIdBN.toArray("le", 8)),
        ],
        PROGRAM_ID
    );

    try {
        if (!program.methods.closeMilling) {
            console.error("Available methods:", Object.keys(program.methods));
            throw new Error("closeMilling method not found in program. Available methods: " + Object.keys(program.methods).join(", "));
        }

        // Verify milling exists
        const accountInfo = await connection.getAccountInfo(millingPDA);
        if (accountInfo === null) {
            throw new Error(`Milling ${millingIdBN.toString()} does not exist on Solana. Cannot close non-existent milling.`);
        }

        console.log("Calling closeMilling with milling_id:", millingIdBN.toString());
        console.log("WARNING: This will permanently delete the account and return rent");

        const txSig = await program.methods
            .closeMilling(millingIdBN)
            .accounts({
                milling: millingPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        console.log("Milling Account Closed on Solana (rent returned):", txSig);
        return txSig;
    } catch (err: any) {
        console.error("Anchor Program closeMilling Failed:", err);
        throw new Error(`Failed to execute Anchor closeMilling instruction: ${err.message || err.toString()}`);
    }
};

// ============================================
// PRODUCTION SEASON FUNCTIONS
// ============================================

/**
 * Helper to validate and convert season_id to BN
 */
const validateAndConvertSeasonId = (season_id: any, operation: string): BN => {
    if (season_id === undefined || season_id === null) {
        throw new Error(`Missing season_id for ${operation}`);
    }
    
    let seasonIdBN: BN;
    if (typeof season_id === 'string') {
        seasonIdBN = new BN(season_id);
    } else if (typeof season_id === 'number') {
        seasonIdBN = new BN(season_id);
    } else if (BN.isBN(season_id)) {
        seasonIdBN = season_id;
    } else {
        throw new Error(`Invalid season_id type for ${operation}: ${typeof season_id}`);
    }
    
    if (seasonIdBN.isNeg()) {
        throw new Error(`season_id must be positive for ${operation}`);
    }
    
    return seasonIdBN;
};

/**
 * Convert date string or Date object to Unix timestamp (i64)
 */
const dateToUnixTimestamp = (date: string | Date | null | undefined): number | null => {
    if (!date) return null;
    
    try {
        const dateObj = typeof date === 'string' ? new Date(date) : date;
        if (isNaN(dateObj.getTime())) {
            return null;
        }
        return Math.floor(dateObj.getTime() / 1000); // Convert to Unix timestamp (seconds)
    } catch {
        return null;
    }
};

/**
 * Submit a new production season to Solana
 * @param seasonData Object containing season fields
 * @returns Transaction signature
 */
export const submitSeasonToSolana = async (seasonData: any): Promise<string> => {
    const {
        season_id,
        farmer_id,
        crop_year,
        season,              // 'wet' or 'dry'
        variety,
        planned_practice,
        planting_date,
        irrigation_practice,
        fertilizer_used,
        pesticide_used,
        harvest_date,
        total_yield_kg,
        processed_yield_kg,
        moisture_content,
        carbon_smart_certified,
        validation_status,  // 'pending', 'validated', 'rejected'
        validator_id,
        geotagging,
    } = seasonData;

    const seasonIdBN = validateAndConvertSeasonId(season_id, "submission");

    const [seasonPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("season"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(seasonIdBN.toArray("le", 8)),
        ],
        PROGRAM_ID
    );

    // Convert season enum string to u8 (0=wet, 1=dry, 255=not set)
    let seasonU8: number | null = null;
    if (season !== undefined && season !== null) {
        if (season === 'wet') {
            seasonU8 = 0;
        } else if (season === 'dry') {
            seasonU8 = 1;
        }
    }

    // Convert validation_status enum string to u8 (0=pending, 1=validated, 2=rejected)
    let validationStatusU8: number | null = null;
    if (validation_status !== undefined && validation_status !== null) {
        const statusMap: { [key: string]: number } = {
            'pending': 0,
            'validated': 1,
            'rejected': 2,
        };
        validationStatusU8 = statusMap[validation_status] ?? null;
    }

    // Convert dates to Unix timestamps
    const plantingDateTimestamp = dateToUnixTimestamp(planting_date);
    const harvestDateTimestamp = dateToUnixTimestamp(harvest_date);

    // Convert decimal values to integers for Solana storage
    // Weights: kg to grams (multiply by 1000)
    const totalYieldInGrams = total_yield_kg !== undefined && total_yield_kg !== null
        ? Math.floor(total_yield_kg * 1000) : null;
    const processedYieldInGrams = processed_yield_kg !== undefined && processed_yield_kg !== null
        ? Math.floor(processed_yield_kg * 1000) : null;
    
    // Moisture: percentage to basis points (multiply by 100)
    const moistureBasisPoints = moisture_content !== undefined && moisture_content !== null
        ? Math.floor(moisture_content * 100) : null;

    // Convert carbon_smart_certified boolean to u8
    const carbonSmartU8 = carbon_smart_certified !== undefined && carbon_smart_certified !== null
        ? (carbon_smart_certified ? 1 : 0) : null;

    try {
        if (!program.methods.createSeason) {
            console.error("Available methods:", Object.keys(program.methods));
            throw new Error("createSeason method not found in program. Available methods: " + Object.keys(program.methods).join(", "));
        }

        console.log("Calling createSeason with season_id:", seasonIdBN.toString());
        console.log("Season payload:", {
            season_id: seasonIdBN.toString(),
            farmer_id,
            crop_year,
            season: seasonU8,
            variety,
            total_yield_kg: totalYieldInGrams,
        });

        // Use sentinel values instead of null to reduce stack usage
        // Sentinels: u64::MAX = not set, i64::MIN = not set, 255 = not set (u8), empty string = not set
        const MAX_U64 = new BN('18446744073709551615'); // u64::MAX
        const MIN_I64 = new BN('-9223372036854775808'); // i64::MIN
        
        const txSig = await program.methods
            .createSeason(
                seasonIdBN,
                new BN(String(farmer_id || 0), 10),
                crop_year || "",
                seasonU8 !== null ? seasonU8 : 255,                    // 255 = not set
                variety || "",                                          // Empty string = not set
                planned_practice || "",                                 // Empty string = not set
                plantingDateTimestamp !== null ? new BN(plantingDateTimestamp, 10) : MIN_I64, // i64::MIN = not set
                irrigation_practice || "",                             // Empty string = not set
                fertilizer_used || "",                                  // Empty string = not set
                pesticide_used || "",                                   // Empty string = not set
                harvestDateTimestamp !== null ? new BN(harvestDateTimestamp, 10) : MIN_I64,   // i64::MIN = not set
                totalYieldInGrams !== null ? new BN(String(totalYieldInGrams), 10) : MAX_U64, // u64::MAX = not set
                processedYieldInGrams !== null ? new BN(String(processedYieldInGrams), 10) : MAX_U64, // u64::MAX = not set
                moistureBasisPoints !== null ? new BN(String(moistureBasisPoints), 10) : MAX_U64, // u64::MAX = not set
                carbonSmartU8 !== null ? carbonSmartU8 : 255,           // 255 = not set
                validationStatusU8 !== null ? validationStatusU8 : 255, // 255 = not set
                validator_id ? new BN(String(validator_id), 10) : MAX_U64, // u64::MAX = not set
                geotagging || ""                                        // Empty string = not set
            )
            .accounts({
                season: seasonPDA,
                authority: wallet.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([feePayer])
            .rpc();

        console.log("Season Submitted to Solana:", txSig);
        return txSig;
    } catch (err: any) {
        console.error("Anchor Program createSeason Failed:", err);
        console.error("Error details:", {
            message: err.message,
            stack: err.stack,
            name: err.name,
            cause: err.cause
        });
        throw new Error(`Failed to execute Anchor createSeason instruction: ${err.message || err.toString()}`);
    }
};

/**
 * Check if a production season exists on Solana
 * @param seasonId The season ID to check
 * @returns Object with exists flag and optional account data
 */
export const checkSeasonExistsOnSolana = async (seasonId: any): Promise<{ exists: boolean; pda?: string; accountData?: any }> => {
    const seasonIdBN = validateAndConvertSeasonId(seasonId, "existence check");

    const [seasonPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("season"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(seasonIdBN.toArray("le", 8)),
        ],
        PROGRAM_ID
    );

    try {
        const accountInfo = await connection.getAccountInfo(seasonPDA);

        if (accountInfo === null) {
            return { exists: false };
        }

        if (!accountInfo.owner.equals(PROGRAM_ID)) {
            return { exists: false };
        }

        return {
            exists: true,
            pda: seasonPDA.toBase58()
        };
    } catch (err: any) {
        console.error("Error checking season existence:", err);
        return { exists: false };
    }
};

/**
 * Get a production season from Solana
 * @param seasonId The season ID to fetch
 * @returns Season account data
 */
export const getSeasonFromSolana = async (seasonId: any): Promise<any> => {
    const seasonIdBN = validateAndConvertSeasonId(seasonId, "fetch");

    const [seasonPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("season"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(seasonIdBN.toArray("le", 8)),
        ],
        PROGRAM_ID
    );

    try {
        const seasonAccount = await (program.account as any).seasonAccount.fetch(seasonPDA);
        
        // Convert season u8 back to string
        const seasonMap: { [key: number]: string } = {
            0: 'wet',
            1: 'dry',
        };
        const seasonStr = seasonMap[seasonAccount.season] || null;

        // Convert validation_status u8 back to string
        const validationStatusMap: { [key: number]: string } = {
            0: 'pending',
            1: 'validated',
            2: 'rejected',
        };
        const validationStatusStr = validationStatusMap[seasonAccount.validationStatus] || 'pending';

        // Convert Unix timestamps back to ISO date strings
        const plantingDate = seasonAccount.plantingDate.toNumber() > 0
            ? new Date(seasonAccount.plantingDate.toNumber() * 1000).toISOString()
            : null;
        const harvestDate = seasonAccount.harvestDate.toNumber() > 0
            ? new Date(seasonAccount.harvestDate.toNumber() * 1000).toISOString()
            : null;

        return {
            season_id: seasonAccount.seasonId.toString(),
            farmer_id: seasonAccount.farmerId.toString(),
            crop_year: Buffer.from(seasonAccount.cropYear.slice(0, seasonAccount.cropYearLen)).toString('utf8'),
            season: seasonStr,
            variety: seasonAccount.varietyLen > 0
                ? Buffer.from(seasonAccount.variety.slice(0, seasonAccount.varietyLen)).toString('utf8')
                : null,
            planned_practice: seasonAccount.plannedPracticeLen > 0
                ? Buffer.from(seasonAccount.plannedPractice.slice(0, seasonAccount.plannedPracticeLen)).toString('utf8')
                : null,
            planting_date: plantingDate,
            irrigation_practice: seasonAccount.irrigationPracticeLen > 0
                ? Buffer.from(seasonAccount.irrigationPractice.slice(0, seasonAccount.irrigationPracticeLen)).toString('utf8')
                : null,
            fertilizer_used: seasonAccount.fertilizerUsedLen > 0
                ? Buffer.from(seasonAccount.fertilizerUsed.slice(0, seasonAccount.fertilizerUsedLen)).toString('utf8')
                : null,
            pesticide_used: seasonAccount.pesticideUsedLen > 0
                ? Buffer.from(seasonAccount.pesticideUsed.slice(0, seasonAccount.pesticideUsedLen)).toString('utf8')
                : null,
            harvest_date: harvestDate,
            total_yield_kg: seasonAccount.totalYieldKg.toNumber() / 1000, // Convert grams back to kg
            processed_yield_kg: seasonAccount.processedYieldKg.toNumber() / 1000, // Convert grams back to kg
            moisture_content: seasonAccount.moistureContent.toNumber() / 100, // Convert basis points to percentage
            carbon_smart_certified: seasonAccount.carbonSmartCertified === 1,
            validation_status: validationStatusStr,
            validator_id: seasonAccount.validatorId.toString(),
            geotagging: seasonAccount.geotaggingLen > 0
                ? Buffer.from(seasonAccount.geotagging.slice(0, seasonAccount.geotaggingLen)).toString('utf8')
                : null,
            is_active: seasonAccount.isActive === 1,
            timestamp: seasonAccount.timestamp.toNumber(),
            pda: seasonPDA.toBase58()
        };
    } catch (err: any) {
        console.error("Error fetching season from Solana:", err);
        throw new Error(`Failed to fetch season ${seasonIdBN.toString()} from Solana: ${err.message}`);
    }
};

/**
 * Update a production season on Solana
 * @param seasonData Object containing season_id and fields to update
 * @returns Transaction signature
 */
export const updateSeasonOnSolana = async (seasonData: any): Promise<string> => {
    const { season_id, ...updateFields } = seasonData;

    const seasonIdBN = validateAndConvertSeasonId(season_id, "update");

    const [seasonPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("season"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(seasonIdBN.toArray("le", 8)),
        ],
        PROGRAM_ID
    );

    // Convert optional fields
    const seasonU8 = updateFields.season !== undefined
        ? (updateFields.season === 'wet' ? 0 : updateFields.season === 'dry' ? 1 : null)
        : null;

    const validationStatusU8 = updateFields.validation_status !== undefined
        ? (updateFields.validation_status === 'pending' ? 0
            : updateFields.validation_status === 'validated' ? 1
            : updateFields.validation_status === 'rejected' ? 2
            : null)
        : null;

    const plantingDateTimestamp = dateToUnixTimestamp(updateFields.planting_date);
    const harvestDateTimestamp = dateToUnixTimestamp(updateFields.harvest_date);

    const totalYieldInGrams = updateFields.total_yield_kg !== undefined
        ? Math.floor(updateFields.total_yield_kg * 1000) : null;
    const processedYieldInGrams = updateFields.processed_yield_kg !== undefined
        ? Math.floor(updateFields.processed_yield_kg * 1000) : null;
    const moistureBasisPoints = updateFields.moisture_content !== undefined
        ? Math.floor(updateFields.moisture_content * 100) : null;

    const carbonSmartU8 = updateFields.carbon_smart_certified !== undefined
        ? (updateFields.carbon_smart_certified ? 1 : 0) : null;

    try {
        if (!program.methods.updateSeason) {
            console.error("Available methods:", Object.keys(program.methods));
            throw new Error("updateSeason method not found in program. Available methods: " + Object.keys(program.methods).join(", "));
        }

        // Verify season exists
        const accountInfo = await connection.getAccountInfo(seasonPDA);
        if (accountInfo === null) {
            throw new Error(`Season ${seasonIdBN.toString()} does not exist on Solana. Cannot update non-existent season.`);
        }

        console.log("Calling updateSeason with season_id:", seasonIdBN.toString());

        // Use sentinel values instead of null to reduce stack usage
        // Sentinels: u64::MAX = don't update, i64::MIN = don't update, 255 = don't update (u8), empty string = don't update
        const MAX_U64 = new BN('18446744073709551615'); // u64::MAX
        const MIN_I64 = new BN('-9223372036854775808'); // i64::MIN
        
        const txSig = await program.methods
            .updateSeason(
                seasonIdBN,
                updateFields.crop_year || "",                    // Empty string = don't update
                seasonU8 !== null ? seasonU8 : 255,            // 255 = don't update
                updateFields.variety || "",                     // Empty string = don't update
                updateFields.planned_practice || "",            // Empty string = don't update
                plantingDateTimestamp !== null ? new BN(plantingDateTimestamp, 10) : MIN_I64, // i64::MIN = don't update
                updateFields.irrigation_practice || "",        // Empty string = don't update
                updateFields.fertilizer_used || "",             // Empty string = don't update
                updateFields.pesticide_used || "",              // Empty string = don't update
                harvestDateTimestamp !== null ? new BN(harvestDateTimestamp, 10) : MIN_I64,   // i64::MIN = don't update
                totalYieldInGrams !== null ? new BN(String(totalYieldInGrams), 10) : MAX_U64, // u64::MAX = don't update
                processedYieldInGrams !== null ? new BN(String(processedYieldInGrams), 10) : MAX_U64, // u64::MAX = don't update
                moistureBasisPoints !== null ? new BN(String(moistureBasisPoints), 10) : MAX_U64, // u64::MAX = don't update
                carbonSmartU8 !== null ? carbonSmartU8 : 255,   // 255 = don't update
                validationStatusU8 !== null ? validationStatusU8 : 255, // 255 = don't update
                updateFields.validator_id ? new BN(String(updateFields.validator_id), 10) : MAX_U64, // u64::MAX = don't update
                updateFields.geotagging || ""                   // Empty string = don't update
            )
            .accounts({
                season: seasonPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        console.log("Season Updated on Solana:", txSig);
        return txSig;
    } catch (err: any) {
        console.error("Anchor Program updateSeason Failed:", err);
        throw new Error(`Failed to execute Anchor updateSeason instruction: ${err.message || err.toString()}`);
    }
};

/**
 * Soft delete a production season on Solana (set is_active = 0)
 * @param seasonData Object containing season_id
 * @returns Transaction signature
 */
export const deleteSeasonOnSolana = async (seasonData: any): Promise<string> => {
    const { season_id } = seasonData;

    const seasonIdBN = validateAndConvertSeasonId(season_id, "deletion");

    const [seasonPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("season"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(seasonIdBN.toArray("le", 8)),
        ],
        PROGRAM_ID
    );

    try {
        if (!program.methods.deleteSeason) {
            console.error("Available methods:", Object.keys(program.methods));
            throw new Error("deleteSeason method not found in program. Available methods: " + Object.keys(program.methods).join(", "));
        }

        // Verify season exists
        const accountInfo = await connection.getAccountInfo(seasonPDA);
        if (accountInfo === null) {
            throw new Error(`Season ${seasonIdBN.toString()} does not exist on Solana. Cannot delete non-existent season.`);
        }

        console.log("Calling deleteSeason with season_id:", seasonIdBN.toString());

        const txSig = await program.methods
            .deleteSeason(seasonIdBN)
            .accounts({
                season: seasonPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        console.log("Season Deleted (Deactivated) on Solana:", txSig);
        return txSig;
    } catch (err: any) {
        console.error("Anchor Program deleteSeason Failed:", err);
        throw new Error(`Failed to execute Anchor deleteSeason instruction: ${err.message || err.toString()}`);
    }
};

/**
 * Close a season account permanently (removes from blockchain, returns rent)
 * WARNING: This permanently deletes the account
 * @param seasonData Object containing season_id
 * @returns Transaction signature
 */
export const closeSeasonOnSolana = async (seasonData: any): Promise<string> => {
    const { season_id } = seasonData;

    const seasonIdBN = validateAndConvertSeasonId(season_id, "closing account");

    const [seasonPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("season"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(seasonIdBN.toArray("le", 8)),
        ],
        PROGRAM_ID
    );

    try {
        if (!program.methods.closeSeason) {
            console.error("Available methods:", Object.keys(program.methods));
            throw new Error("closeSeason method not found in program. Available methods: " + Object.keys(program.methods).join(", "));
        }

        // Verify season exists
        const accountInfo = await connection.getAccountInfo(seasonPDA);
        if (accountInfo === null) {
            throw new Error(`Season ${seasonIdBN.toString()} does not exist on Solana. Cannot close non-existent season.`);
        }

        console.log("Calling closeSeason with season_id:", seasonIdBN.toString());
        console.log("WARNING: This will permanently delete the account and return rent");

        const txSig = await program.methods
            .closeSeason(seasonIdBN)
            .accounts({
                season: seasonPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        console.log("Season Account Closed on Solana (rent returned):", txSig);
        return txSig;
    } catch (err: any) {
        console.error("Anchor Program closeSeason Failed:", err);
        throw new Error(`Failed to execute Anchor closeSeason instruction: ${err.message || err.toString()}`);
    }
};

// ============================================
// ADMIN INITIALIZATION FUNCTIONS
// ============================================

/**
 * Initialize the program (one-time setup)
 * Creates the ProgramConfig account with the fee payer as super_admin
 * @returns Transaction signature
 */
export const initializeProgramOnSolana = async (): Promise<string> => {
    // PDA for config account (seeds: "config")
    const [configPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        PROGRAM_ID
    );

    try {
        // Check if already initialized
        const existingConfig = await connection.getAccountInfo(configPDA);
        if (existingConfig !== null) {
            throw new Error("Program is already initialized. Config account exists at: " + configPDA.toBase58());
        }

        // Verify the method exists
        if (!program.methods.initializeProgram) {
            console.error("Available methods:", Object.keys(program.methods));
            throw new Error("initializeProgram method not found in program. IDL may need to be updated. Available methods: " + Object.keys(program.methods).join(", "));
        }

        console.log("========================================");
        console.log("INITIALIZING PROGRAM");
        console.log("Config PDA:", configPDA.toBase58());
        console.log("Authority (Super Admin):", feePayer.publicKey.toBase58());
        console.log("Program ID:", PROGRAM_ID.toBase58());
        console.log("========================================");

        const txSig = await program.methods
            .initializeProgram()
            .accounts({
                config: configPDA,
                authority: wallet.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([feePayer])
            .rpc();

        console.log("========================================");
        console.log("PROGRAM INITIALIZED SUCCESSFULLY");
        console.log("Transaction Signature:", txSig);
        console.log("========================================");

        return txSig;
    } catch (err: any) {
        console.error("Program initialization failed:", err);
        console.error("Error details:", {
            message: err.message,
            stack: err.stack,
            name: err.name,
            cause: err.cause
        });
        throw new Error(`Failed to initialize program: ${err.message || err.toString()}`);
    }
};

/**
 * Get program configuration and initialization status
 * @returns Object containing isInitialized, superAdmin, and initializedAt
 */
export const getProgramConfig = async (): Promise<{
    isInitialized: boolean;
    superAdmin: string | null;
    initializedAt: number | null;
    configPda: string;
}> => {
    const [configPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        PROGRAM_ID
    );

    try {
        const accountInfo = await connection.getAccountInfo(configPDA);
        
        if (accountInfo === null) {
            console.log("Program config account does not exist (not initialized)");
            return {
                isInitialized: false,
                superAdmin: null,
                initializedAt: null,
                configPda: configPDA.toBase58(),
            };
        }

        // Verify it's owned by our program
        if (!accountInfo.owner.equals(PROGRAM_ID)) {
            console.warn("Config account exists but is not owned by our program");
            return {
                isInitialized: false,
                superAdmin: null,
                initializedAt: null,
                configPda: configPDA.toBase58(),
            };
        }

        // Fetch and decode the account data using Anchor
        // Use type assertion since IDL types are loaded dynamically
        try {
            const configAccount = await (program.account as any).programConfig.fetch(configPDA);
            
            console.log("Program config fetched successfully:", {
                isInitialized: configAccount.isInitialized,
                superAdmin: configAccount.superAdmin.toBase58(),
                initializedAt: configAccount.initializedAt.toNumber(),
            });

            return {
                isInitialized: configAccount.isInitialized,
                superAdmin: configAccount.superAdmin.toBase58(),
                initializedAt: configAccount.initializedAt.toNumber(),
                configPda: configPDA.toBase58(),
            };
        } catch (decodeErr: any) {
            console.error("Failed to decode config account:", decodeErr);
            // Account exists but couldn't be decoded - might be corrupted or wrong structure
            return {
                isInitialized: false,
                superAdmin: null,
                initializedAt: null,
                configPda: configPDA.toBase58(),
            };
        }
    } catch (err: any) {
        console.error("Error fetching program config:", err);
        throw new Error(`Failed to fetch program config: ${err.message || err.toString()}`);
    }
};

/**
 * Get the fee payer's public key (useful for admin verification)
 * @returns The fee payer's public key as a base58 string
 */
export const getFeePayerPublicKey = (): string => {
    return feePayer.publicKey.toBase58();
};

/**
 * Close the program config (un-initialize the program)
 * Only the super_admin can do this
 * WARNING: For testing purposes only
 * @returns Transaction signature
 */
export const closeConfigOnSolana = async (): Promise<string> => {
    // PDA for config account (seeds: "config")
    const [configPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        PROGRAM_ID
    );

    try {
        // Check if config exists
        const existingConfig = await connection.getAccountInfo(configPDA);
        if (existingConfig === null) {
            throw new Error("Program config does not exist. Program is not initialized.");
        }

        // Verify caller is super_admin by fetching config
        const config = await getProgramConfig();
        if (!config.isInitialized) {
            throw new Error("Program is not initialized.");
        }
        
        if (config.superAdmin !== feePayer.publicKey.toBase58()) {
            throw new Error(`Unauthorized: Only the super_admin (${config.superAdmin}) can close the config. Current authority: ${feePayer.publicKey.toBase58()}`);
        }

        // Verify the method exists
        if (!program.methods.closeConfig) {
            console.error("Available methods:", Object.keys(program.methods));
            throw new Error("closeConfig method not found in program. IDL may need to be updated.");
        }

        console.log("========================================");
        console.log("CLOSING PROGRAM CONFIG (UN-INITIALIZING)");
        console.log("Config PDA:", configPDA.toBase58());
        console.log("Authority:", feePayer.publicKey.toBase58());
        console.log("========================================");

        const txSig = await program.methods
            .closeConfig()
            .accounts({
                config: configPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        console.log("========================================");
        console.log("PROGRAM CONFIG CLOSED SUCCESSFULLY");
        console.log("Transaction Signature:", txSig);
        console.log("Program is now UN-INITIALIZED");
        console.log("========================================");

        return txSig;
    } catch (err: any) {
        console.error("Close config failed:", err);
        console.error("Error details:", {
            message: err.message,
            stack: err.stack,
            name: err.name,
            cause: err.cause
        });
        throw new Error(`Failed to close config: ${err.message || err.toString()}`);
    }
};

// ============================================
// TRANSACTION MANAGEMENT
// ============================================

/**
 * Submit a new transaction to Solana
 * @param transactionData Object containing transaction fields
 * @returns Transaction signature
 */
export const submitTransactionToSolana = async (transactionData: any): Promise<string> => {
    const {
        from_actor_id,
        to_actor_id,
        quantity,
        unit_price,
        payment_reference,
        nonce,
        batch_id,
        moisture,
        status,
        is_test,
    } = transactionData;

    // Validate required fields
    if (from_actor_id === undefined || from_actor_id === null) {
        throw new Error('from_actor_id is required for transaction creation');
    }
    if (to_actor_id === undefined || to_actor_id === null) {
        throw new Error('to_actor_id is required for transaction creation');
    }
    if (nonce === undefined || nonce === null) {
        throw new Error('nonce is required for transaction creation');
    }
    if (batch_id === undefined || batch_id === null) {
        throw new Error('batch_id is required for transaction creation');
    }

    // Convert all IDs to BN (always use string to prevent precision loss)
    const fromActorIdBN = new BN(String(from_actor_id), 10);
    const toActorIdBN = new BN(String(to_actor_id), 10);
    const batchIdBN = new BN(String(batch_id), 10);
    const quantityBN = new BN(String(quantity || 0), 10);
    const unitPriceBN = new BN(String(unit_price || 0), 10);
    const moistureBN = new BN(String(moisture || 0), 10);

    // Validate nonce (u8: 0-255)
    const nonceNum = parseInt(String(nonce), 10);
    if (isNaN(nonceNum) || nonceNum < 0 || nonceNum > 255) {
        throw new Error(`Invalid nonce: ${nonce}. Must be a u8 (0-255)`);
    }

    // Validate payment_reference (u8: 0-255)
    const paymentRefNum = parseInt(String(payment_reference || 0), 10);
    if (isNaN(paymentRefNum) || paymentRefNum < 0 || paymentRefNum > 255) {
        throw new Error(`Invalid payment_reference: ${payment_reference}. Must be a u8 (0-255)`);
    }

    // Validate status (u8: 0-8 based on our mapping)
    const statusNum = parseInt(String(status || 0), 10);
    if (isNaN(statusNum) || statusNum < 0 || statusNum > 8) {
        throw new Error(`Invalid status: ${status}. Must be a u8 (0-8)`);
    }

    // Validate is_test (u8: 0 or 1)
    const isTestNum = parseInt(String(is_test || 0), 10);
    if (isTestNum !== 0 && isTestNum !== 1) {
        throw new Error(`Invalid is_test: ${is_test}. Must be 0 or 1`);
    }

    // Derive PDA using seeds: ["tx", authority, nonce]
    let transactionPDA: PublicKey;
    let bump: number;
    
    try {
        [transactionPDA, bump] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("tx"),
                feePayer.publicKey.toBuffer(),
                Buffer.from([nonceNum]), // nonce is u8, so single byte
            ],
            PROGRAM_ID
        );

        console.log("Transaction PDA Derivation:", {
            nonce: nonceNum,
            pda: transactionPDA.toBase58(),
            bump: bump,
        });
        
        // Check if account already exists
        const accountInfo = await connection.getAccountInfo(transactionPDA);
        if (accountInfo !== null) {
            throw new Error(
                `Transaction account already exists on Solana. ` +
                `Nonce: ${nonceNum}, PDA: ${transactionPDA.toBase58()}. ` +
                `This indicates a nonce collision or duplicate creation attempt.`
            );
        }
    } catch (pdaErr: any) {
        if (pdaErr.message?.includes('already exists')) {
            throw pdaErr;
        }
        throw new Error(`Failed to derive PDA for nonce ${nonceNum}: ${pdaErr.message}`);
    }

    try {
        if (!program.methods.createTransaction) {
            console.error("Available methods:", Object.keys(program.methods));
            throw new Error("createTransaction method not found in program. Available methods: " + Object.keys(program.methods).join(", "));
        }

        console.log("Calling createTransaction with data:", {
            from_actor_id: fromActorIdBN.toString(),
            to_actor_id: toActorIdBN.toString(),
            quantity: quantityBN.toString(),
            unit_price: unitPriceBN.toString(),
            payment_reference: paymentRefNum,
            nonce: nonceNum,
            batch_id: batchIdBN.toString(),
            moisture: moistureBN.toString(),
            status: statusNum,
            is_test: isTestNum,
        });

        const txSig = await program.methods
            .createTransaction(
                fromActorIdBN,
                toActorIdBN,
                quantityBN,
                unitPriceBN,
                paymentRefNum,
                nonceNum,
                batchIdBN,
                moistureBN,
                statusNum,
                isTestNum
            )
            .accounts({
                transaction: transactionPDA,
                authority: wallet.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([feePayer])
            .rpc();

        console.log("Transaction Created on Solana:", txSig);
        return txSig;
    } catch (err: any) {
        console.error("Anchor Program createTransaction Failed:", err);
        console.error("Error details:", {
            message: err.message,
            stack: err.stack,
            name: err.name,
            cause: err.cause
        });
        
        // Check for specific Anchor errors
        if (err.message?.includes('assertion') || err.message?.includes('Assertion')) {
            console.error("PDA Derivation Debug:", {
                nonce: nonceNum,
                calculated_pda: transactionPDA.toBase58(),
                authority: feePayer.publicKey.toBase58(),
            });
            
            throw new Error(
                `Solana assertion failed: PDA derivation mismatch. ` +
                `This usually means nonce is invalid or account already exists. ` +
                `Nonce: ${nonceNum}, PDA: ${transactionPDA.toBase58()}. ` +
                `Original error: ${err.message}`
            );
        }
        
        throw new Error(`Failed to execute Anchor instruction: ${err.message || err.toString()}`);
    }
};

/**
 * Check if a transaction exists on Solana by nonce
 * @param nonce The nonce used to create the transaction (u8: 0-255)
 * @returns true if transaction exists, false otherwise
 */
export const checkTransactionExistsOnSolana = async (nonce: number | string): Promise<boolean> => {
    try {
        const nonceNum = parseInt(String(nonce), 10);
        
        if (isNaN(nonceNum) || nonceNum < 0 || nonceNum > 255) {
            throw new Error(`Invalid nonce format: ${nonce}. Must be a u8 (0-255)`);
        }
        
        // PDA for transaction account (seeds: "tx", authority, nonce)
        const [transactionPDA] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("tx"),
                feePayer.publicKey.toBuffer(),
                Buffer.from([nonceNum]), // nonce is u8, single byte
            ],
            PROGRAM_ID
        );

        // Check if account exists
        const accountInfo = await connection.getAccountInfo(transactionPDA);
        
        if (accountInfo === null) {
            console.log(`Transaction with nonce ${nonceNum} does not exist on Solana (PDA: ${transactionPDA.toBase58()})`);
            return false;
        }

        // Verify it's owned by our program
        if (!accountInfo.owner.equals(PROGRAM_ID)) {
            console.warn(`Transaction with nonce ${nonceNum} account exists but is not owned by our program`);
            return false;
        }

        console.log(`Transaction with nonce ${nonceNum} exists on Solana (PDA: ${transactionPDA.toBase58()})`);
        return true;
    } catch (err: any) {
        console.error("Error checking transaction existence on Solana:", err);
        throw new Error(`Failed to check transaction existence: ${err.message || err.toString()}`);
    }
};