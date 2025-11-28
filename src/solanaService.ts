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
if (!process.env.SOLANA_SECRET_KEY) {
    throw new Error("CRITICAL: Missing SOLANA_SECRET_KEY in .env");
}

const PROGRAM_ID = new PublicKey(process.env.SOLANA_PROGRAM_ID);

// Connection
const connection = new Connection(
    process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    "processed"
);

// Fee payer
let secret: number[];

try {
    secret = JSON.parse(process.env.SOLANA_SECRET_KEY);
} catch {
    throw new Error("SOLANA_SECRET_KEY must be a valid JSON array of numbers");
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

// Initialize program properly
// Type assertion needed due to TypeScript constructor overload resolution
const program = new (anchor.Program as any)(idlContent, PROGRAM_ID, provider);

// Quick method check
if (!program.methods) {
    throw new Error("CRITICAL: Anchor methods failed to load. IDL mismatch?");
}

// Log available methods for debugging
console.log("Program initialized. Available methods:", Object.keys(program.methods || {}));

export const checkProgramInitialization = async (): Promise<boolean> => {
    try {
        const acc = await connection.getAccountInfo(PROGRAM_ID);
        return acc !== null;
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
        actor_type,
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

    // Map actor_type string to u8 (0=farmer, 1=miller, 2=trader, 3=retailer, 4=consumer)
    const actorTypeMap: { [key: string]: number } = {
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
    // Adjust this conversion based on your currency's smallest unit
    const balanceInSmallestUnit = Math.floor((balance || 0) * 100); // Assuming 2 decimal places

    // PDA for actor account (seeds: "actor", authority, actor_id)
    const [actorPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("actor"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(new BN(actor_id).toArray("le", 8)),
        ],
        PROGRAM_ID
    );

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
            .createActor(
                new BN(actor_id),
                new BN(user_id),
                name || "",
                actorTypeU8,
                isActiveU8,
                province || "",
                city || "",
                new BN(balanceInSmallestUnit),
                pin || "000000",
                address || "",
                farm_id || "",
                new BN(farmer_id),
                new BN(assigned_tps)
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
        throw new Error(`Failed to execute Anchor instruction: ${err.message || err.toString()}`);
    }
};
