import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair, Connection } from "@solana/web3.js";
import * as dotenv from "dotenv";
import { readFileSync } from "fs";

dotenv.config();

async function main() {
    const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
    const connection = new Connection(rpcUrl, "confirmed");
    
    if (!process.env.SOLANA_FEE_PAYER_SECRET_KEY) {
        throw new Error("Missing SOLANA_FEE_PAYER_SECRET_KEY in .env");
    }
    
    const secret = JSON.parse(process.env.SOLANA_FEE_PAYER_SECRET_KEY);
    const feePayer = Keypair.fromSecretKey(new Uint8Array(secret));
    const wallet = new anchor.Wallet(feePayer);
    
    const provider = new anchor.AnchorProvider(connection, wallet, {
        preflightCommitment: "confirmed",
    });

    const idlPath = "./src/idl/core.json";
    const idl = JSON.parse(readFileSync(idlPath, "utf8"));
    const programId = new PublicKey(process.env.SOLANA_CORE_PROGRAM_ID);
    const program = new anchor.Program(idl, provider);

    const [bridgeConfigPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("bridge_config")],
        programId
    );

    console.log("Core Program ID:", programId.toBase58());
    console.log("Bridge Config PDA:", bridgeConfigPDA.toBase58());
    console.log("Authority (Fee Payer):", feePayer.publicKey.toBase58());

    // Check if already initialized
    const accountInfo = await connection.getAccountInfo(bridgeConfigPDA);
    if (accountInfo) {
        console.log("✅ Core bridge_config is already initialized.");
        return;
    }

    console.log("Initializing Core bridge_config...");

    try {
        const txSig = await program.methods
            .initializeBridgeConfig(feePayer.publicKey)
            .accounts({
                bridgeConfig: bridgeConfigPDA,
                payer: feePayer.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([feePayer])
            .rpc();

        console.log("✅ Core Initialization successful!");
        console.log("Transaction Signature:", txSig);
    } catch (err) {
        console.error("❌ Error during instruction execution:");
        throw err;
    }
}

main().catch((err) => {
    console.error("❌ Initialization failed:");
    console.error(err);
    process.exit(1);
});
