import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import {
    connection,
    feePayer,
    wallet,
    tracingProgram,
    bridgeConfigPDA,
    CORE_PROGRAM_ID,
} from "../config/solanaConfig.js";

/**
 * Helper to validate and convert drying_id to BN
 */
const validateAndConvertDryingId = (drying_id: any, operation: string): BN => {
    if (drying_id === undefined || drying_id === null)
        throw new Error(`Missing drying_id for ${operation}`);
    let dryingIdBN = new BN(String(drying_id), 10);
    if (dryingIdBN.isNeg())
        throw new Error(`drying_id must be positive for ${operation}`);
    return dryingIdBN;
};

/**
 * Submit a new drying record to Solana
 */
export const submitDryingToSolana = async (
    dryingData: any,
): Promise<string> => {
    const {
        drying_id,
        batch_id,
        dryer_actor_id,
        initial_mc,
        final_mc,
        temperature,
        airflow,
        humidity,
        duration,
        price,
        initial_weight,
        final_weight,
    } = dryingData;
    const dryingIdBN = validateAndConvertDryingId(drying_id, "submission");
    const [dryingPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("drying"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(new BN(dryingIdBN).toArray("le", 4)),
        ],
        tracingProgram.programId,
    );

    const txSig = await (tracingProgram.methods as any)
        .createDrying(
            dryingIdBN.toNumber(),
            new BN(String(batch_id || 0), 10).toNumber(),
            new BN(String(dryer_actor_id || 0), 10).toNumber(),
            Math.round((initial_mc || 0) * 100),
            Math.round((final_mc || 0) * 100),
            Math.round((temperature || 0) * 100),
            Math.round((airflow || 0) * 100),
            Math.round((humidity || 0) * 100),
            Math.round((duration || 0) * 60),
            new BN(String(Math.round((price || 0) * 100)), 10),
            Math.round((initial_weight || 0) * 1000),
            Math.round((final_weight || 0) * 1000),
        )
        .accounts({
            drying: dryingPDA,
            bridgeConfig: bridgeConfigPDA,
            dryerActor: PublicKey.findProgramAddressSync(
                [
                    Buffer.from("actor"),
                    feePayer.publicKey.toBuffer(),
                    Buffer.from(new BN(dryer_actor_id).toArray("le", 8)),
                ],
                CORE_PROGRAM_ID,
            )[0],
            authority: wallet.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .signers([feePayer])
        .rpc();

    return txSig;
};

/**
 * Check if a drying record exists
 */
export const checkDryingExistsOnSolana = async (
    dryingId: any,
): Promise<{ exists: boolean; pda?: string }> => {
    const dryingIdBN = validateAndConvertDryingId(dryingId, "existence check");
    const [dryingPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("drying"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(dryingIdBN.toArray("le", 4)),
        ],
        tracingProgram.programId,
    );
    const accountInfo = await connection.getAccountInfo(dryingPDA);
    if (
        accountInfo === null ||
        !accountInfo.owner.equals(tracingProgram.programId)
    )
        return { exists: false };
    return { exists: true, pda: dryingPDA.toBase58() };
};

/**
 * Get a drying record
 */
export const getDryingFromSolana = async (dryingId: any): Promise<any> => {
    const dryingIdBN = validateAndConvertDryingId(dryingId, "fetch");
    const [dryingPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("drying"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(dryingIdBN.toArray("le", 4)),
        ],
        tracingProgram.programId,
    );
    const dryingAccount = await (
        tracingProgram.account as any
    ).dryingAccount.fetch(dryingPDA);
    return {
        drying_id: dryingAccount.dryingId.toString(),
        batch_id: dryingAccount.batchId.toString(),
        dryer_actor_id: dryingAccount.dryerActorId.toString(),
        initial_mc: dryingAccount.initialMc.toNumber() / 100,
        final_mc: dryingAccount.finalMc.toNumber() / 100,
        temperature: dryingAccount.temperature.toNumber() / 100,
        airflow: dryingAccount.airflow.toNumber() / 100,
        humidity: dryingAccount.humidity.toNumber() / 100,
        duration: dryingAccount.duration.toNumber() / 60,
        price: dryingAccount.price.toNumber() / 100,
        initial_weight: dryingAccount.initialWeight.toNumber() / 1000,
        final_weight: dryingAccount.finalWeight.toNumber() / 1000,
        is_active: dryingAccount.isActive === 1,
        timestamp: dryingAccount.timestamp.toNumber(),
        pda: dryingPDA.toBase58(),
    };
};

/**
 * Update a drying record
 */
export const updateDryingOnSolana = async (
    dryingData: any,
): Promise<string> => {
    const { drying_id } = dryingData;
    const dryingIdBN = validateAndConvertDryingId(drying_id, "update");
    const [dryingPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("drying"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(new BN(dryingIdBN).toArray("le", 4)),
        ],
        tracingProgram.programId,
    );

    const txSig = await (tracingProgram.methods as any)
        .updateDrying(
            dryingIdBN.toNumber(),
            // ... add other fields if needed, for now just keeping it minimal for build
        )
        .accounts({
            drying: dryingPDA,
            bridgeConfig: bridgeConfigPDA,
            authority: wallet.publicKey,
        })
        .signers([feePayer])
        .rpc();
    return txSig;
};

/**
 * Delete a drying record
 */
export const deleteDryingOnSolana = async (
    dryingData: any,
): Promise<string> => {
    const { drying_id } = dryingData;
    const dryingIdBN = validateAndConvertDryingId(drying_id, "deletion");
    const [dryingPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("drying"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(new BN(dryingIdBN).toArray("le", 4)),
        ],
        tracingProgram.programId,
    );

    const txSig = await (tracingProgram.methods as any)
        .deleteDrying(dryingIdBN.toNumber())
        .accounts({
            drying: dryingPDA,
            authority: wallet.publicKey,
        })
        .signers([feePayer])
        .rpc();
    return txSig;
};

/**
 * Close a drying record
 */
export const closeDryingOnSolana = async (dryingData: any): Promise<string> => {
    const { drying_id } = dryingData;
    const dryingIdBN = validateAndConvertDryingId(drying_id, "closing");
    const [dryingPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("drying"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(new BN(dryingIdBN).toArray("le", 4)),
        ],
        tracingProgram.programId,
    );

    const txSig = await (tracingProgram.methods as any)
        .closeDrying(dryingIdBN.toNumber())
        .accounts({
            drying: dryingPDA,
            authority: wallet.publicKey,
        })
        .signers([feePayer])
        .rpc();
    return txSig;
};

/**
 * Helper to validate and convert milling_id to BN
 */
const validateAndConvertMillingId = (
    milling_id: any,
    operation: string,
): BN => {
    if (milling_id === undefined || milling_id === null)
        throw new Error(`Missing milling_id for ${operation}`);
    let millingIdBN = new BN(String(milling_id), 10);
    if (millingIdBN.isNeg())
        throw new Error(`milling_id must be positive for ${operation}`);
    return millingIdBN;
};

/**
 * Submit a new milling record to Solana
 */
export const submitMillingToSolana = async (
    millingData: any,
): Promise<string> => {
    const {
        milling_id,
        miller_id,
        batch_id,
        milling_type,
        quality,
        total_weight_kg,
        total_weight_processed_kg,
        recovery,
        moisture,
        price,
        actual_price,
    } = millingData;
    const millingIdBN = validateAndConvertMillingId(milling_id, "submission");
    const [millingPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("milling"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(new BN(millingIdBN).toArray("le", 4)),
        ],
        tracingProgram.programId,
    );

    const txSig = await (tracingProgram.methods as any)
        .createMilling(
            millingIdBN.toNumber(),
            new BN(String(miller_id || 0), 10).toNumber(),
            new BN(String(batch_id || 0), 10).toNumber(),
            milling_type || "",
            quality || "",
            Math.round((total_weight_kg || 0) * 1000),
            Math.round((total_weight_processed_kg || 0) * 1000),
            Math.round((recovery || 0) * 100),
            Math.round((moisture || 0) * 100),
            new BN(String(Math.round((price || 0) * 100)), 10),
            new BN(String(Math.round((actual_price || 0) * 100)), 10),
        )
        .accounts({
            milling: millingPDA,
            bridgeConfig: bridgeConfigPDA,
            millerActor: PublicKey.findProgramAddressSync(
                [
                    Buffer.from("actor"),
                    feePayer.publicKey.toBuffer(),
                    Buffer.from(new BN(miller_id).toArray("le", 8)),
                ],
                CORE_PROGRAM_ID,
            )[0],
            authority: wallet.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .signers([feePayer])
        .rpc();

    return txSig;
};

/**
 * Check if a milling record exists
 */
export const checkMillingExistsOnSolana = async (
    millingId: any,
): Promise<{ exists: boolean; pda?: string }> => {
    const millingIdBN = validateAndConvertMillingId(
        millingId,
        "existence check",
    );
    const [millingPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("milling"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(millingIdBN.toArray("le", 4)),
        ],
        tracingProgram.programId,
    );
    const accountInfo = await connection.getAccountInfo(millingPDA);
    if (
        accountInfo === null ||
        !accountInfo.owner.equals(tracingProgram.programId)
    )
        return { exists: false };
    return { exists: true, pda: millingPDA.toBase58() };
};

/**
 * Get a milling record
 */
export const getMillingFromSolana = async (millingId: any): Promise<any> => {
    const millingIdBN = validateAndConvertMillingId(millingId, "fetch");
    const [millingPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("milling"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(millingIdBN.toArray("le", 4)),
        ],
        tracingProgram.programId,
    );
    const millingAccount = await (
        tracingProgram.account as any
    ).millingAccount.fetch(millingPDA);
    return {
        milling_id: millingAccount.millingId.toString(),
        miller_id: millingAccount.millerId.toString(),
        batch_id: millingAccount.batchId.toString(),
        milling_type: Buffer.from(
            millingAccount.millingType.slice(0, millingAccount.millingTypeLen),
        ).toString("utf8"),
        quality: Buffer.from(
            millingAccount.quality.slice(0, millingAccount.qualityLen),
        ).toString("utf8"),
        total_weight_kg: millingAccount.totalWeightKg.toNumber() / 1000,
        total_weight_processed_kg:
            millingAccount.totalWeightProcessedKg.toNumber() / 1000,
        recovery: millingAccount.recovery.toNumber() / 100,
        moisture: millingAccount.moisture.toNumber() / 100,
        price: millingAccount.price.toNumber() / 100,
        actual_price: millingAccount.actualPrice.toNumber() / 100,
        is_active: millingAccount.isActive === 1,
        timestamp: millingAccount.timestamp.toNumber(),
        pda: millingPDA.toBase58(),
    };
};

/**
 * Update a milling record
 */
export const updateMillingOnSolana = async (
    millingData: any,
): Promise<string> => {
    const { milling_id } = millingData;
    const millingIdBN = validateAndConvertMillingId(milling_id, "update");
    const [millingPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("milling"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(new BN(millingIdBN).toArray("le", 4)),
        ],
        tracingProgram.programId,
    );

    const txSig = await (tracingProgram.methods as any)
        .updateMilling(
            millingIdBN.toNumber(),
            // ... other fields
        )
        .accounts({
            milling: millingPDA,
            bridgeConfig: bridgeConfigPDA,
            authority: wallet.publicKey,
        })
        .signers([feePayer])
        .rpc();
    return txSig;
};

/**
 * Delete a milling record
 */
export const deleteMillingOnSolana = async (
    millingData: any,
): Promise<string> => {
    const { milling_id } = millingData;
    const millingIdBN = validateAndConvertMillingId(milling_id, "deletion");
    const [millingPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("milling"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(new BN(millingIdBN).toArray("le", 4)),
        ],
        tracingProgram.programId,
    );

    const txSig = await (tracingProgram.methods as any)
        .deleteMilling(millingIdBN.toNumber())
        .accounts({
            milling: millingPDA,
            authority: wallet.publicKey,
        })
        .signers([feePayer])
        .rpc();
    return txSig;
};

/**
 * Close a milling record
 */
export const closeMillingOnSolana = async (
    millingData: any,
): Promise<string> => {
    const { milling_id } = millingData;
    const millingIdBN = validateAndConvertMillingId(milling_id, "closing");
    const [millingPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("milling"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(new BN(millingIdBN).toArray("le", 4)),
        ],
        tracingProgram.programId,
    );

    const txSig = await (tracingProgram.methods as any)
        .closeMilling(millingIdBN.toNumber())
        .accounts({
            milling: millingPDA,
            authority: wallet.publicKey,
        })
        .signers([feePayer])
        .rpc();
    return txSig;
};

/**
 * Helper to validate and convert season_id to BN
 */
const validateAndConvertSeasonId = (season_id: any, operation: string): BN => {
    if (season_id === undefined || season_id === null)
        throw new Error(`Missing season_id for ${operation}`);
    let seasonIdBN = new BN(String(season_id), 10);
    if (seasonIdBN.isNeg())
        throw new Error(`season_id must be positive for ${operation}`);
    return seasonIdBN;
};

/**
 * Submit a new production season
 */
export const submitSeasonToSolana = async (
    seasonData: any,
): Promise<string> => {
    const {
        season_id,
        farmer_id,
        crop_year,
        season,
        variety,
        planned_practice,
        planting_date,
        irrigation_practice,
        fertilizer_used,
        pesticide_used,
        harvest_date,
        total_yield_kg,
        processed_yield_kg,
        moisture_content,
        carbon_smart_certified,
        validation_status,
        validator_id,
        geotagging,
    } = seasonData;
    const seasonIdBN = validateAndConvertSeasonId(season_id, "submission");
    const [seasonPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("season"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(new BN(seasonIdBN).toArray("le", 4)),
        ],
        tracingProgram.programId,
    );

    const plantingDateTimestamp = planting_date
        ? Math.floor(new Date(planting_date).getTime() / 1000)
        : -1;
    const harvestDateTimestamp = harvest_date
        ? Math.floor(new Date(harvest_date).getTime() / 1000)
        : -1;

    const txSig = await (tracingProgram.methods as any)
        .createSeason(
            seasonIdBN.toNumber(),
            new BN(String(farmer_id || 0), 10).toNumber(),
            crop_year || "",
            season === "wet" ? 0 : season === "dry" ? 1 : 255,
            variety || "",
            planned_practice || "",
            new BN(plantingDateTimestamp),
            irrigation_practice || "",
            fertilizer_used || "",
            pesticide_used || "",
            new BN(harvestDateTimestamp),
            new BN(String(Math.floor((total_yield_kg || 0) * 1000)), 10),
            new BN(String(Math.floor((processed_yield_kg || 0) * 1000)), 10),
            Math.floor((moisture_content || 0) * 100),
            carbon_smart_certified ? 1 : 0,
            validation_status === "pending"
                ? 0
                : validation_status === "validated"
                  ? 1
                  : validation_status === "rejected"
                    ? 2
                    : 255,
            new BN(String(validator_id || 0), 10).toNumber(),
            geotagging || "",
        )
        .accounts({
            season: seasonPDA,
            farmerActor: PublicKey.findProgramAddressSync(
                [
                    Buffer.from("actor"),
                    feePayer.publicKey.toBuffer(),
                    Buffer.from(new BN(farmer_id).toArray("le", 8)),
                ],
                CORE_PROGRAM_ID,
            )[0],
            bridgeConfig: bridgeConfigPDA,
            authority: wallet.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .signers([feePayer])
        .rpc();

    return txSig;
};

/**
 * Check if a season exists
 */
export const checkSeasonExistsOnSolana = async (
    seasonId: any,
): Promise<{ exists: boolean; pda?: string }> => {
    const seasonIdBN = validateAndConvertSeasonId(seasonId, "existence check");
    const [seasonPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("season"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(seasonIdBN.toArray("le", 4)),
        ],
        tracingProgram.programId,
    );
    const accountInfo = await connection.getAccountInfo(seasonPDA);
    if (
        accountInfo === null ||
        !accountInfo.owner.equals(tracingProgram.programId)
    )
        return { exists: false };
    return { exists: true, pda: seasonPDA.toBase58() };
};

/**
 * Get a season
 */
export const getSeasonFromSolana = async (seasonId: any): Promise<any> => {
    const seasonIdBN = validateAndConvertSeasonId(seasonId, "fetch");
    const [seasonPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("season"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(seasonIdBN.toArray("le", 4)),
        ],
        tracingProgram.programId,
    );
    const seasonAccount = await (
        tracingProgram.account as any
    ).seasonAccount.fetch(seasonPDA);
    return {
        season_id: seasonAccount.seasonId.toString(),
        farmer_id: seasonAccount.farmerId.toString(),
        crop_year: Buffer.from(
            seasonAccount.cropYear.slice(0, seasonAccount.cropYearLen),
        ).toString("utf8"),
        season:
            seasonAccount.season === 0
                ? "wet"
                : seasonAccount.season === 1
                  ? "dry"
                  : null,
        variety: Buffer.from(
            seasonAccount.variety.slice(0, seasonAccount.varietyLen),
        ).toString("utf8"),
        planting_date:
            seasonAccount.plantingDate.toNumber() > 0
                ? new Date(
                      seasonAccount.plantingDate.toNumber() * 1000,
                  ).toISOString()
                : null,
        harvest_date:
            seasonAccount.harvestDate.toNumber() > 0
                ? new Date(
                      seasonAccount.harvestDate.toNumber() * 1000,
                  ).toISOString()
                : null,
        total_yield_kg: seasonAccount.totalYieldKg.toNumber() / 1000,
        processed_yield_kg: seasonAccount.processedYieldKg.toNumber() / 1000,
        moisture_content: seasonAccount.moistureContent.toNumber() / 100,
        carbon_smart_certified: seasonAccount.carbonSmartCertified === 1,
        validation_status:
            seasonAccount.validationStatus === 0
                ? "pending"
                : seasonAccount.validationStatus === 1
                  ? "validated"
                  : "rejected",
        validator_id: seasonAccount.validatorId.toString(),
        is_active: seasonAccount.isActive === 1,
        timestamp: seasonAccount.timestamp.toNumber(),
        pda: seasonPDA.toBase58(),
    };
};

/**
 * Update a season
 */
export const updateSeasonOnSolana = async (
    seasonData: any,
): Promise<string> => {
    const { season_id } = seasonData;
    const seasonIdBN = validateAndConvertSeasonId(season_id, "update");
    const [seasonPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("season"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(new BN(seasonIdBN).toArray("le", 4)),
        ],
        tracingProgram.programId,
    );

    const txSig = await (tracingProgram.methods as any)
        .updateSeason(
            seasonIdBN.toNumber(),
            // ... other fields
        )
        .accounts({
            season: seasonPDA,
            bridgeConfig: bridgeConfigPDA,
            authority: wallet.publicKey,
        })
        .signers([feePayer])
        .rpc();
    return txSig;
};

/**
 * Delete a season
 */
export const deleteSeasonOnSolana = async (
    seasonData: any,
): Promise<string> => {
    const { season_id } = seasonData;
    const seasonIdBN = validateAndConvertSeasonId(season_id, "deletion");
    const [seasonPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("season"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(new BN(seasonIdBN).toArray("le", 4)),
        ],
        tracingProgram.programId,
    );

    const txSig = await (tracingProgram.methods as any)
        .deleteSeason(seasonIdBN.toNumber())
        .accounts({
            season: seasonPDA,
            authority: wallet.publicKey,
        })
        .signers([feePayer])
        .rpc();
    return txSig;
};

/**
 * Close a season
 */
export const closeSeasonOnSolana = async (seasonData: any): Promise<string> => {
    const { season_id } = seasonData;
    const seasonIdBN = validateAndConvertSeasonId(season_id, "closing");
    const [seasonPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("season"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(new BN(seasonIdBN).toArray("le", 4)),
        ],
        tracingProgram.programId,
    );

    const txSig = await (tracingProgram.methods as any)
        .closeSeason(seasonIdBN.toNumber())
        .accounts({
            season: seasonPDA,
            authority: wallet.publicKey,
        })
        .signers([feePayer])
        .rpc();
    return txSig;
};
