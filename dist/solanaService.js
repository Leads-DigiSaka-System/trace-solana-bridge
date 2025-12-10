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
// Try to fetch IDL from on-chain first, fallback to local IDL
let program;
try {
    console.log("Attempting to fetch IDL from on-chain program...");
    const onChainIdl = await anchor.Program.fetchIdl(PROGRAM_ID, provider);
    if (onChainIdl) {
        console.log("Using on-chain IDL");
        program = new anchor.Program(onChainIdl, provider);
    }
    else {
        console.log("On-chain IDL not found, using local IDL");
        program = new anchor.Program(idlContent, provider);
    }
}
catch (error) {
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
    const { actor_id, user_id, name, roles, // JSON string or array of roles
    organization, // Optional organization (BLO, Buyback, COOP)
    is_active, province, city, balance, pin, address, farm_id, farmer_id, assigned_tps, } = actorData;
    // Parse roles - if it's a JSON string, parse it; if it's already an array, use it
    let rolesString;
    if (typeof roles === 'string') {
        try {
            // Try to parse as JSON first
            const parsed = JSON.parse(roles);
            rolesString = Array.isArray(parsed) ? parsed.join(',') : roles;
        }
        catch {
            // If not JSON, assume it's already comma-separated
            rolesString = roles;
        }
    }
    else if (Array.isArray(roles)) {
        rolesString = roles.join(',');
    }
    else {
        rolesString = '';
    }
    // actor_type kept as 0 for backward compatibility (roles is the new way)
    const actorTypeU8 = 0;
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
            .createActor(new BN(actor_id), new BN(user_id), name || "", actorTypeU8, rolesString || "", organization || null, isActiveU8, province || "", city || "", new BN(balanceInSmallestUnit), pin || "000000", address || "", farm_id || "", new BN(farmer_id), new BN(assigned_tps))
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
    const { actor_id, name, roles, // JSON string or array of roles
    organization, // Optional organization (BLO, Buyback, COOP)
    is_active, province, city, balance, address, assigned_tps, } = actorData;
    // Parse roles - if it's a JSON string, parse it; if it's already an array, use it
    let rolesString = null;
    if (roles !== undefined && roles !== null) {
        if (typeof roles === 'string') {
            try {
                // Try to parse as JSON first
                const parsed = JSON.parse(roles);
                rolesString = Array.isArray(parsed) ? parsed.join(',') : roles;
            }
            catch {
                // If not JSON, assume it's already comma-separated
                rolesString = roles;
            }
        }
        else if (Array.isArray(roles)) {
            rolesString = roles.join(',');
        }
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
            new BN(actor_id), // _actor_id: u64 (required)
            name !== undefined ? name : null, // name: Option<String>
            rolesString !== null ? rolesString : null, // roles: Option<String>
            organization !== undefined && organization !== null ? organization : null, // organization: Option<String>
            isActiveU8 !== null ? isActiveU8 : null, // is_active: Option<u8>
            province !== undefined ? province : null, // province: Option<String>
            city !== undefined ? city : null, // city: Option<String>
            balanceInSmallestUnit !== null ? balanceInSmallestUnit : null, // balance: Option<u64>
            address !== undefined ? address : null, // address: Option<String>
            assigned_tps !== undefined ? new BN(assigned_tps) : null, // assigned_tps: Option<u64>
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
export const deleteActorOnSolana = async (actorData) => {
    const { actor_id } = actorData;
    if (!actor_id) {
        throw new Error("actor_id is required for deletion");
    }
    // PDA for actor account (seeds: "actor", authority, actor_id)
    const [actorPDA] = PublicKey.findProgramAddressSync([
        Buffer.from("actor"),
        feePayer.publicKey.toBuffer(),
        Buffer.from(new BN(actor_id).toArray("le", 8)),
    ], PROGRAM_ID);
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
            console.error(`Actor ${actor_id} does not exist on Solana (PDA: ${actorPDA.toBase58()}). Cannot delete non-existent actor.`);
            throw new Error(`Actor ${actor_id} does not exist on Solana. Cannot delete non-existent actor.`);
        }
        // Verify it's owned by our program
        if (!accountInfo.owner.equals(PROGRAM_ID)) {
            console.error(`Actor ${actor_id} account exists but is not owned by our program`);
            throw new Error(`Actor ${actor_id} account exists but is not owned by the correct program.`);
        }
        console.log("Calling deleteActor with actor_id:", actor_id);
        // Call delete_actor instruction (only requires actor_id for PDA derivation)
        const txSig = await program.methods
            .deleteActor(new BN(actor_id))
            .accounts({
            actor: actorPDA,
            authority: wallet.publicKey,
        })
            .signers([feePayer])
            .rpc();
        console.log("Actor Deleted (Deactivated) on Solana:", txSig);
        return txSig;
    }
    catch (err) {
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
// ============================================
// ADMIN INITIALIZATION FUNCTIONS
// ============================================
/**
 * Initialize the program (one-time setup)
 * Creates the ProgramConfig account with the fee payer as super_admin
 * @returns Transaction signature
 */
export const initializeProgramOnSolana = async () => {
    // PDA for config account (seeds: "config")
    const [configPDA] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
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
    }
    catch (err) {
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
export const getProgramConfig = async () => {
    const [configPDA] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
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
            const configAccount = await program.account.programConfig.fetch(configPDA);
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
        }
        catch (decodeErr) {
            console.error("Failed to decode config account:", decodeErr);
            // Account exists but couldn't be decoded - might be corrupted or wrong structure
            return {
                isInitialized: false,
                superAdmin: null,
                initializedAt: null,
                configPda: configPDA.toBase58(),
            };
        }
    }
    catch (err) {
        console.error("Error fetching program config:", err);
        throw new Error(`Failed to fetch program config: ${err.message || err.toString()}`);
    }
};
/**
 * Get the fee payer's public key (useful for admin verification)
 * @returns The fee payer's public key as a base58 string
 */
export const getFeePayerPublicKey = () => {
    return feePayer.publicKey.toBase58();
};
/**
 * Close the program config (un-initialize the program)
 * Only the super_admin can do this
 * WARNING: For testing purposes only
 * @returns Transaction signature
 */
export const closeConfigOnSolana = async () => {
    // PDA for config account (seeds: "config")
    const [configPDA] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
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
    }
    catch (err) {
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
//# sourceMappingURL=solanaService.js.map