import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import * as dotenv from "dotenv";
import type { Idl } from "@coral-xyz/anchor";
import { loadFeePayerFromEnv } from "./outboundWorkerConfig.js";

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
    "SOLANA_RPC_URL",
];

for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        throw new Error(`CRITICAL: Missing ${envVar} in .env`);
    }
}

function validatedProgramId(envName: string, idl: unknown): PublicKey {
    const configured = new PublicKey(process.env[envName]!);
    const idlAddress = (idl as { address?: unknown }).address;
    if (typeof idlAddress !== "string" || configured.toBase58() !== idlAddress) {
        throw new Error(`CRITICAL: ${envName} does not match the deployed address in its IDL`);
    }
    return configured;
}

// Fail closed if deployment configuration and the bundled interfaces disagree.
export const CORE_PROGRAM_ID = validatedProgramId("SOLANA_CORE_PROGRAM_ID", coreIdl);
export const BUYBACK_PROGRAM_ID = validatedProgramId("SOLANA_BUYBACK_PROGRAM_ID", buybackIdl);
export const DISTRIBUTION_PROGRAM_ID = validatedProgramId(
    "SOLANA_DISTRIBUTION_PROGRAM_ID",
    distributionIdl,
);
export const TRACING_PROGRAM_ID = validatedProgramId("SOLANA_TRACING_PROGRAM_ID", tracingIdl);
export const CARBON_PROGRAM_ID = validatedProgramId("SOLANA_CARBON_PROGRAM_ID", carbonIdl);

// Connection
export const connection = new Connection(
    process.env.SOLANA_RPC_URL!,
    "finalized",
);

// Fee payer
export const feePayer = loadFeePayerFromEnv(process.env);

// Provider / Wallet
export const wallet = new anchor.Wallet(feePayer);
export const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "finalized",
    preflightCommitment: "finalized",
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

export const [buybackBridgeConfigPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("bridge_config")],
    BUYBACK_PROGRAM_ID,
);

export const [distributionBridgeConfigPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("bridge_config")],
    DISTRIBUTION_PROGRAM_ID,
);

console.log("Modular programs initialized.");
