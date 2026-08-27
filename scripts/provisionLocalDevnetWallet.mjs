import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

const root = path.resolve(process.cwd());
const walletPath = path.resolve(root, "data", "local-devnet-fee-payer.keypair.json");
if (!walletPath.startsWith(`${root}${path.sep}`)) {
    throw new Error("Wallet path escaped the bridge directory");
}

await mkdir(path.dirname(walletPath), { recursive: true });

let feePayer;
let created = false;
try {
    const bytes = JSON.parse(await readFile(walletPath, "utf8"));
    feePayer = Keypair.fromSecretKey(Uint8Array.from(bytes));
} catch (error) {
    if (error?.code !== "ENOENT") throw error;
    feePayer = Keypair.generate();
    const temporary = `${walletPath}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
        await handle.writeFile(`${JSON.stringify(Array.from(feePayer.secretKey))}\n`, "utf8");
        await handle.sync();
    } finally {
        await handle.close();
    }
    await rename(temporary, walletPath);
    created = true;
}

const rpcUrl = process.env.SOLANA_RPC_URL;
if (!rpcUrl) throw new Error("SOLANA_RPC_URL is required");
const connection = new Connection(rpcUrl, "finalized");
const memoProgram = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

const genesisHash = await connection.getGenesisHash();
if (genesisHash !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") {
    throw new Error(`RPC is not Solana devnet: ${genesisHash}`);
}

const memoAccount = await connection.getAccountInfo(memoProgram, "finalized");
if (!memoAccount?.executable) throw new Error("Solana Memo program is not executable");

const balanceBefore = await connection.getBalance(feePayer.publicKey, "finalized");
let airdropSignature = null;
if (process.argv.includes("--airdrop") && balanceBefore < 5_000_000) {
    airdropSignature = await connection.requestAirdrop(feePayer.publicKey, 10_000_000);
    const latest = await connection.getLatestBlockhash("finalized");
    await connection.confirmTransaction({ signature: airdropSignature, ...latest }, "finalized");
}

const balanceAfter = await connection.getBalance(feePayer.publicKey, "finalized");
console.log(JSON.stringify({
    created,
    wallet_path: path.relative(root, walletPath),
    address: feePayer.publicKey.toBase58(),
    genesis_hash: genesisHash,
    memo_program_executable: true,
    balance_before_sol: balanceBefore / LAMPORTS_PER_SOL,
    balance_after_sol: balanceAfter / LAMPORTS_PER_SOL,
    airdrop_signature: airdropSignature,
}));
