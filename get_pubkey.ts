// get_pubkey.ts (Run this once in your Node.js project)

import { Keypair } from "@solana/web3.js";
import * as dotenv from "dotenv";

dotenv.config();

if (!process.env.SOLANA_SECRET_KEY) {
    throw new Error("Missing SOLANA_SECRET_KEY in .env");
}

// 1. Parse the JSON string from the environment variable
let secret: number[];
try {
    secret = JSON.parse(process.env.SOLANA_SECRET_KEY);
} catch {
    throw new Error("SOLANA_SECRET_KEY must be a valid JSON array of numbers.");
}

// 2. Create the Keypair object from the secret array
const feePayer = Keypair.fromSecretKey(new Uint8Array(secret));

// 3. Extract and display the Public Key in Base58 format
const publicKeyBase58 = feePayer.publicKey.toBase58();

console.log("------------------------------------------");
console.log("⭐️ YOUR FEE PAYER PUBLIC KEY (Base58): ⭐️");
console.log(publicKeyBase58);
console.log("------------------------------------------");