import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as dotenv from "dotenv";
import type { Idl } from "@coral-xyz/anchor";

// IDL imports
import coreIdl from "../idl/core.json" with { type: "json" };
import buybackIdl from "../idl/buyback.json" with { type: "json" };
import distributionIdl from "../idl/distribution.json" with { type: "json" };
import tracingIdl from "../idl/tracing.json" with { type: "json" };
import carbonIdl from "../idl/carbon.json" with { type: "json" };

dotenv.config();

// Enforce required environment variables
const requiredEnvVars = [
    "SOLANA_CORE_PROGRAM_ID",
    "SOLANA_BUYBACK_PROGRAM_ID",
    "SOLANA_DISTRIBUTION_PROGRAM_ID",
    "SOLANA_TRACING_PROGRAM_ID",
    "SOLANA_CARBON_PROGRAM_ID",
    "SOLANA_FEE_PAYER_SECRET_KEY",
];

for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        throw new Error(`CRITICAL: Missing ${envVar} in .env`);
    }
}

// Program IDs
export const CORE_PROGRAM_ID = new PublicKey(
    process.env.SOLANA_CORE_PROGRAM_ID!,
);
export const BUYBACK_PROGRAM_ID = new PublicKey(
    process.env.SOLANA_BUYBACK_PROGRAM_ID!,
);
export const DISTRIBUTION_PROGRAM_ID = new PublicKey(
    process.env.SOLANA_DISTRIBUTION_PROGRAM_ID!,
);
export const TRACING_PROGRAM_ID = new PublicKey(
    process.env.SOLANA_TRACING_PROGRAM_ID!,
);
export const CARBON_PROGRAM_ID = new PublicKey(
    process.env.SOLANA_CARBON_PROGRAM_ID!,
);

// Connection
export const connection = new Connection(
    process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    "processed",
);

// Fee payer
let secret: number[];
try {
    secret = JSON.parse(process.env.SOLANA_FEE_PAYER_SECRET_KEY!);
} catch {
    throw new Error(
        "SOLANA_FEE_PAYER_SECRET_KEY must be a valid JSON array of numbers",
    );
}

export const feePayer = Keypair.fromSecretKey(new Uint8Array(secret));

// Provider / Wallet
export const wallet = new anchor.Wallet(feePayer);
export const provider = new anchor.AnchorProvider(connection, wallet, {
    preflightCommitment: "confirmed",
});

anchor.setProvider(provider);

// Initialize all modular programs
export const coreProgram = new anchor.Program(coreIdl as Idl, provider);
export const buybackProgram = new anchor.Program(buybackIdl as Idl, provider);
export const distributionProgram = new anchor.Program(
    distributionIdl as Idl,
    provider,
);
export const tracingProgram = new anchor.Program(tracingIdl as Idl, provider);
export const carbonProgram = new anchor.Program(carbonIdl as Idl, provider);

// Global PDA for bridge_config (owned by coreProgram)
export const [bridgeConfigPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("bridge_config")],
    CORE_PROGRAM_ID,
);

console.log("Modular programs initialized.");
