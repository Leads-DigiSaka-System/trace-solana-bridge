import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, } from "@solana/web3.js";
import * as dotenv from "dotenv";
import { Buffer } from "buffer";
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
const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "processed");
// Fee payer
let secret;
try {
    secret = JSON.parse(process.env.SOLANA_SECRET_KEY);
}
catch {
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
const idlContent = idlJson;
idlContent.address = PROGRAM_ID.toBase58();
const ProgramClass = anchor.Program;
const program = new ProgramClass(idlContent, PROGRAM_ID);
// Quick method check
if (!program.methods) {
    throw new Error("CRITICAL: Anchor methods failed to load. IDL mismatch?");
}
export const checkProgramInitialization = async () => {
    try {
        const acc = await connection.getAccountInfo(PROGRAM_ID);
        return acc !== null;
    }
    catch (err) {
        console.error("Error during program initialization check:", err);
        throw new Error("Failed to communicate with Solana RPC");
    }
};
export const submitActorToSolana = async (txData) => {
    const { from_actor_id, to_actor_id, quantity, unit_price, payment_reference, nonce, batch_id, moisture, status, is_test, } = txData;
    // PDA for transaction account
    const [transactionPDA] = PublicKey.findProgramAddressSync([
        Buffer.from("tx"),
        feePayer.publicKey.toBuffer(),
        Buffer.from([nonce]),
    ], PROGRAM_ID);
    try {
        const txSig = await program.methods
            .createTransaction(new anchor.BN(from_actor_id), new anchor.BN(to_actor_id), new anchor.BN(quantity), new anchor.BN(unit_price), payment_reference, nonce, new anchor.BN(batch_id), new anchor.BN(moisture), status, is_test)
            .accounts({
            transaction: transactionPDA,
            authority: wallet.publicKey,
            systemProgram: SystemProgram.programId,
        })
            .signers([feePayer])
            .rpc();
        console.log("Transaction Success:", txSig);
        return txSig;
    }
    catch (err) {
        console.error("Anchor Program Call Failed:", err);
        throw new Error(`Failed to execute Anchor instruction: ${err.message}`);
    }
};
//# sourceMappingURL=solanaService.js.map