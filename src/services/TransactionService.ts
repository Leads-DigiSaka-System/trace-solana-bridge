import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import {
    connection,
    feePayer,
    wallet,
    tracingProgram,
    distributionProgram,
    bridgeConfigPDA,
    CORE_PROGRAM_ID,
} from "../config/solanaConfig.js";

/**
 * Submit a new transaction to Solana
 */
export const submitTransactionToSolana = async (
    transactionData: any,
): Promise<string> => {
    const {
        from_actor_id,
        to_actor_id,
        quantity,
        unit_price,
        payment_reference,
        nonce,
        batch_id,
        moisture,
        status,
        is_test,
    } = transactionData;

    const fromActorIdBN = new BN(String(from_actor_id), 10);
    const toActorIdBN = new BN(String(to_actor_id), 10);
    const batchIdBN = new BN(String(batch_id), 10);
    const quantityBN = new BN(String(quantity || 0), 10);
    const unitPriceBN = new BN(String(unit_price || 0), 10);
    const moistureBN = new BN(String(moisture || 0), 10);
    const nonceNum = parseInt(String(nonce), 10);

    const [transactionPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("tx"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(new BN(nonceNum).toArray("le", 4)),
        ],
        tracingProgram.programId,
    );
    const [fromActorPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("actor"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(fromActorIdBN.toArray("le", 8)),
        ],
        CORE_PROGRAM_ID,
    );
    const [toActorPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("actor"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(toActorIdBN.toArray("le", 8)),
        ],
        CORE_PROGRAM_ID,
    );

    const txSig = await (tracingProgram.methods as any)
        .createTransaction(
            fromActorIdBN.toNumber(),
            toActorIdBN.toNumber(),
            quantityBN.toNumber(),
            unitPriceBN,
            String(payment_reference || ""),
            nonceNum,
            batchIdBN.toNumber(),
            moistureBN.toNumber(),
            parseInt(String(status || 0), 10),
            parseInt(String(is_test || 0), 10),
        )
        .accounts({
            transaction: transactionPDA,
            bridgeConfig: bridgeConfigPDA,
            fromActor: fromActorPDA,
            toActor: toActorPDA,
            authority: wallet.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .signers([feePayer])
        .rpc();

    return txSig;
};

/**
 * Add data to an existing transaction record (reusing account)
 */
export const addTransactionToSolana = async (
    transactionData: any,
): Promise<string> => {
    const {
        from_actor_id,
        to_actor_id,
        quantity,
        unit_price,
        payment_reference,
        nonce,
        batch_id,
        moisture,
        status,
        is_test,
    } = transactionData;

    const fromActorIdBN = new BN(String(from_actor_id), 10);
    const toActorIdBN = new BN(String(to_actor_id), 10);
    const batchIdBN = new BN(String(batch_id), 10);
    const quantityBN = new BN(String(quantity || 0), 10);
    const unitPriceBN = new BN(String(unit_price || 0), 10);
    const moistureBN = new BN(String(moisture || 0), 10);
    const nonceNum = parseInt(String(nonce), 10);

    const [transactionPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("tx"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(new BN(nonceNum).toArray("le", 4)),
        ],
        tracingProgram.programId,
    );

    const txSig = await (tracingProgram.methods as any)
        .addTransaction(
            fromActorIdBN.toNumber(),
            toActorIdBN.toNumber(),
            quantityBN.toNumber(),
            unitPriceBN,
            String(payment_reference || ""),
            batchIdBN.toNumber(),
            moistureBN.toNumber(),
            parseInt(String(status || 0), 10),
            parseInt(String(is_test || 0), 10),
        )
        .accounts({
            transaction: transactionPDA,
            authority: wallet.publicKey,
        })
        .signers([feePayer])
        .rpc();

    return txSig;
};

/**
 * Update transaction status
 */
export const updateTransactionOnSolana = async (
    nonce: number | string,
    status: number,
): Promise<string> => {
    const nonceNum = parseInt(String(nonce), 10);

    const [transactionPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("tx"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(new BN(nonceNum).toArray("le", 4)),
        ],
        tracingProgram.programId,
    );

    const txSig = await (tracingProgram.methods as any)
        .updateTransaction(nonceNum, status)
        .accounts({
            transaction: transactionPDA,
            authority: wallet.publicKey,
        })
        .signers([feePayer])
        .rpc();

    return txSig;
};

/**
 * Check if a transaction exists by nonce
 */
export const checkTransactionExistsOnSolana = async (
    nonce: number | string,
): Promise<boolean> => {
    const nonceNum = parseInt(String(nonce), 10);
    const [transactionPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("tx"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(new BN(nonceNum).toArray("le", 4)),
        ],
        tracingProgram.programId,
    );
    const accountInfo = await connection.getAccountInfo(transactionPDA);
    if (
        accountInfo === null ||
        !accountInfo.owner.equals(tracingProgram.programId)
    )
        return false;
    return true;
};
