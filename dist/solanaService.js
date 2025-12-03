import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, } from "@solana/web3.js";
import * as dotenv from "dotenv";
import { Buffer } from "buffer";
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
// Connection
const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "processed");
// Fee payer
let secret;
try {
    secret = JSON.parse(process.env.SOLANA_FEE_PAYER_SECRET_KEY);
}
catch {
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
const idlContent = idlJson;
idlContent.address = PROGRAM_ID.toBase58();
// Initialize program with new Anchor 0.30+ constructor (idl, provider)
// The program ID is read from idl.address
const program = new anchor.Program(idlContent, provider);
// Quick method check
if (!program.methods) {
    throw new Error("CRITICAL: Anchor methods failed to load. IDL mismatch?");
}
// Log available methods for debugging
console.log("Program initialized. Available methods:", Object.keys(program.methods || {}));
export const checkProgramInitialization = async () => {
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
    }
    catch (err) {
        console.error("Error during program initialization check:", err);
        throw new Error("Failed to communicate with Solana RPC");
    }
};
export const submitActorToSolana = async (actorData) => {
    const { actor_id, user_id, name, actor_type, is_active, province, city, balance, pin, address, farm_id, farmer_id, assigned_tps, } = actorData;
    // Map actor_type string to u8 (0=farmer, 1=miller, 2=trader, 3=retailer, 4=consumer)
    const actorTypeMap = {
        'farmer': 0,
        'miller': 1,
        'trader': 2,
        'retailer': 3,
        'consumer': 4,
    };
    const actorTypeU8 = actorTypeMap[actor_type] ?? 0;
    // Convert is_active boolean to u8 (0=false, 1=true)
    const isActiveU8 = is_active ? 1 : 0;
    // Convert balance to smallest unit (assuming balance is in main currency unit, convert to cents/smallest unit)
    // Adjust conversion based on Digisaka currency's smallest unit
    const balanceInSmallestUnit = Math.floor((balance || 0) * 100); // Assuming 2 decimal places
    // PDA for actor account (seeds: "actor", authority, actor_id)
    const [actorPDA] = PublicKey.findProgramAddressSync([
        Buffer.from("actor"),
        feePayer.publicKey.toBuffer(),
        Buffer.from(new BN(actor_id).toArray("le", 8)),
    ], PROGRAM_ID);
    try {
        // Verify the method exists
        if (!program.methods.createActor) {
            console.error("Available methods:", Object.keys(program.methods));
            throw new Error("createActor method not found in program. Available methods: " + Object.keys(program.methods).join(", "));
        }
        console.log("Calling createActor with data:", {
            actor_id,
            user_id,
            name,
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
            .createActor(new BN(actor_id), new BN(user_id), name || "", actorTypeU8, isActiveU8, province || "", city || "", new BN(balanceInSmallestUnit), pin || "000000", address || "", farm_id || "", new BN(farmer_id), new BN(assigned_tps))
            .accounts({
            actor: actorPDA,
            authority: wallet.publicKey,
            systemProgram: SystemProgram.programId,
        })
            .signers([feePayer])
            .rpc();
        console.log("Actor Created on Solana:", txSig);
        return txSig;
    }
    catch (err) {
        console.error("Anchor Program Call Failed:", err);
        console.error("Error details:", {
            message: err.message,
            stack: err.stack,
            name: err.name,
            cause: err.cause
        });
        throw new Error(`Failed to execute Anchor instruction: ${err.message || err.toString()}`);
    }
};
/**
 * Check if an actor account exists on Solana
 * @param actorId The actor ID to check
 * @returns true if actor exists, false otherwise
 */
export const checkActorExistsOnSolana = async (actorId) => {
    try {
        // PDA for actor account (seeds: "actor", authority, actor_id)
        const [actorPDA] = PublicKey.findProgramAddressSync([
            Buffer.from("actor"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(new BN(actorId).toArray("le", 8)),
        ], PROGRAM_ID);
        // Check if account exists
        const accountInfo = await connection.getAccountInfo(actorPDA);
        if (accountInfo === null) {
            console.log(`Actor ${actorId} does not exist on Solana (PDA: ${actorPDA.toBase58()})`);
            return false;
        }
        // Verify it's owned by our program
        if (!accountInfo.owner.equals(PROGRAM_ID)) {
            console.warn(`Actor ${actorId} account exists but is not owned by our program`);
            return false;
        }
        console.log(`Actor ${actorId} exists on Solana (PDA: ${actorPDA.toBase58()})`);
        return true;
    }
    catch (err) {
        console.error("Error checking actor existence on Solana:", err);
        throw new Error(`Failed to check actor existence: ${err.message || err.toString()}`);
    }
};
/**
 * Update an existing actor on Solana
 * @param actorData Object containing actor_id and optional fields to update
 * @returns Transaction signature
 */
export const updateActorOnSolana = async (actorData) => {
    const { actor_id, name, actor_type, is_active, province, city, balance, address, assigned_tps, } = actorData;
    // Map actor_type string to u8 if provided
    let actorTypeU8 = null;
    if (actor_type !== undefined && actor_type !== null) {
        const actorTypeMap = {
            'farmer': 0,
            'miller': 1,
            'trader': 2,
            'retailer': 3,
            'consumer': 4,
        };
        actorTypeU8 = actorTypeMap[actor_type] ?? null;
    }
    // Convert is_active boolean to u8 if provided
    let isActiveU8 = null;
    if (is_active !== undefined && is_active !== null) {
        isActiveU8 = is_active ? 1 : 0;
    }
    // Convert balance to smallest unit if provided
    let balanceInSmallestUnit = null;
    if (balance !== undefined && balance !== null) {
        balanceInSmallestUnit = new BN(Math.floor(balance * 100)); // Assuming 2 decimal places
    }
    // PDA for actor account (seeds: "actor", authority, actor_id)
    const [actorPDA] = PublicKey.findProgramAddressSync([
        Buffer.from("actor"),
        feePayer.publicKey.toBuffer(),
        Buffer.from(new BN(actor_id).toArray("le", 8)),
    ], PROGRAM_ID);
    try {
        // Verify the method exists
        if (!program.methods.updateActor) {
            console.error("Available methods:", Object.keys(program.methods));
            throw new Error("updateActor method not found in program. Available methods: " + Object.keys(program.methods).join(", "));
        }
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
        console.log("Calling updateActor with data:", {
            actor_id,
            name: name !== undefined ? name : null,
            actor_type: actorTypeU8,
            is_active: isActiveU8,
            province: province !== undefined ? province : null,
            city: city !== undefined ? city : null,
            balance: balanceInSmallestUnit ? balanceInSmallestUnit.toString() : null,
            address: address !== undefined ? address : null,
            assigned_tps: assigned_tps !== undefined ? assigned_tps : null,
        });
        // Build the method call with optional parameters
        // Anchor's Option<T> in Rust maps to null in TypeScript
        // actor_id must be the first parameter for Anchor to derive the PDA correctly
        const methodBuilder = program.methods.updateActor(new BN(actor_id), name !== undefined ? name : null, actorTypeU8 !== null ? actorTypeU8 : null, isActiveU8 !== null ? isActiveU8 : null, province !== undefined ? province : null, city !== undefined ? city : null, balanceInSmallestUnit, address !== undefined ? address : null, assigned_tps !== undefined ? new BN(assigned_tps) : null);
        const txSig = await methodBuilder
            .accounts({
            actor: actorPDA,
            authority: wallet.publicKey,
        })
            .signers([feePayer])
            .rpc();
        console.log("Actor Updated on Solana:", txSig);
        return txSig;
    }
    catch (err) {
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
//# sourceMappingURL=solanaService.js.map