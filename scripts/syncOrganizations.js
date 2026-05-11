import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
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

    const coreIdlPath = "./src/idl/core.json";
    const coreIdl = JSON.parse(readFileSync(coreIdlPath, "utf8"));
    const coreProgramId = new PublicKey(process.env.SOLANA_CORE_PROGRAM_ID);
    const coreProgram = new anchor.Program(coreIdl, provider);

    const [bridgeConfigPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("bridge_config")],
        coreProgramId
    );

    // Default organizations to sync for the demo
    const orgsToSync = [
        { id: 1, name: "Supplier Org", type: 0, province: "West Java", city: "Bandung", contact: "John Doe" },
        { id: 2, name: "Warehouse Org", type: 1, province: "West Java", city: "Subang", contact: "Jane Smith" },
    ];

    console.log(`Syncing ${orgsToSync.length} organizations to Solana...`);

    for (const org of orgsToSync) {
        const orgIdBN = new BN(org.id);
        const [orgPDA] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("organization"),
                feePayer.publicKey.toBuffer(),
                Buffer.from(orgIdBN.toArray("le", 8)),
            ],
            coreProgramId
        );

        const exists = await connection.getAccountInfo(orgPDA);
        if (exists) {
            console.log(`✅ Org ${org.id} already exists on-chain at ${orgPDA.toBase58()}`);
            continue;
        }

        console.log(`Syncing Org ${org.id} (${org.name})...`);
        try {
            const txSig = await coreProgram.methods
                .createOrganization(
                    orgIdBN,
                    org.name,
                    org.type,
                    org.province,
                    org.city,
                    org.contact
                )
                .accounts({
                    organization: orgPDA,
                    bridgeConfig: bridgeConfigPDA,
                    authority: feePayer.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([feePayer])
                .rpc();

            console.log(`   ✅ Success! Transaction: ${txSig}`);
        } catch (err) {
            console.error(`   ❌ Failed to sync Org ${org.id}:`, err.message);
        }
    }

    console.log("Sync complete.");
}

main().catch((err) => {
    console.error("❌ Sync failed:");
    console.error(err);
    process.exit(1);
});
