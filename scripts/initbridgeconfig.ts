import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import { distributionProgram, wallet, feePayer, DISTRIBUTION_PROGRAM_ID } from "../src/config";

async function main() {
    // Derive the same PDA your program uses
    const [bridgeConfigPDA, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from("bridge_config")],
        DISTRIBUTION_PROGRAM_ID,
    );

    console.log("Bridge Config PDA:", bridgeConfigPDA.toBase58());

    // Check if already initialized
    const existing = await distributionProgram.provider.connection.getAccountInfo(bridgeConfigPDA);
    if (existing) {
        console.log("✅ bridge_config already initialized, nothing to do.");
        return;
    }

    // Call your program's initialize instruction
    // ⚠️ Rename to match your actual IDL instruction name
    const txSig = await (distributionProgram.methods as any)
        .initializeBridgeConfig()   // or .initialize() — check your IDL
        .accounts({
            bridgeConfig: bridgeConfigPDA,
            authority: wallet.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .signers([feePayer])
        .rpc();

    console.log("✅ bridge_config initialized:", txSig);
    console.log(`   https://explorer.solana.com/tx/${txSig}?cluster=devnet`);
}

main().catch((err) => {
    console.error("Init failed:", err);
    process.exit(1);
});