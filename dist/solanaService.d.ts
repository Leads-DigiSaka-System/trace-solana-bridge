export declare const checkProgramInitialization: () => Promise<boolean>;
export declare const submitActorToSolana: (actorData: any) => Promise<string>;
/**
 * Check if an actor account exists on Solana
 * @param actorId The actor ID to check (number or string - BN handles both)
 * @returns true if actor exists, false otherwise
 */
export declare const checkActorExistsOnSolana: (actorId: number | string) => Promise<boolean>;
/**
 * Get actor account details from Solana
 * @param actorId The actor ID to fetch (number or string - BN handles both)
 * @returns Actor account data or null if not found
 */
export declare const getActorFromSolana: (actorId: number | string) => Promise<any | null>;
/**
 * Update an existing actor on Solana
 * @param actorData Object containing actor_id and optional fields to update
 * @returns Transaction signature
 */
export declare const updateActorOnSolana: (actorData: any) => Promise<string>;
export declare const deleteActorOnSolana: (actorData: any) => Promise<string>;
/**
 * Close an actor account permanently (removes from blockchain, returns rent)
 * WARNING: This permanently deletes the account - use only for orphaned accounts
 * @param actorData Object containing actor_id
 * @returns Transaction signature
 */
export declare const closeActorOnSolana: (actorData: any) => Promise<string>;
/**
 * Submit a new rice batch to Solana
 * @param batchData Object containing batch data
 * @returns Transaction signature
 */
export declare const submitBatchToSolana: (batchData: any) => Promise<string>;
/**
 * Check if a batch account exists on Solana
 * @param batchId The batch ID to check
 * @returns true if batch exists, false otherwise
 */
export declare const checkBatchExistsOnSolana: (batchId: number | string) => Promise<boolean>;
/**
 * Get batch account details from Solana
 * @param batchId The batch ID to fetch
 * @returns Batch account data or null if not found
 */
export declare const getBatchFromSolana: (batchId: number | string) => Promise<any | null>;
/**
 * Update an existing batch on Solana
 * @param batchData Object containing batch_id and optional fields to update
 * @returns Transaction signature
 */
export declare const updateBatchOnSolana: (batchData: any) => Promise<string>;
/**
 * Soft delete a batch on Solana (set is_active = 0)
 * @param batchData Object containing batch_id
 * @returns Transaction signature
 */
export declare const deleteBatchOnSolana: (batchData: any) => Promise<string>;
/**
 * Close a batch account permanently (removes from blockchain, returns rent)
 * WARNING: This permanently deletes the account
 * @param batchData Object containing batch_id
 * @returns Transaction signature
 */
export declare const closeBatchOnSolana: (batchData: any) => Promise<string>;
/**
 * Submit a new drying record to Solana
 * @param dryingData Object containing drying fields
 * @returns Transaction signature
 */
export declare const submitDryingToSolana: (dryingData: any) => Promise<string>;
/**
 * Check if a drying record exists on Solana
 * @param dryingId The drying ID to check
 * @returns Object with exists flag and optional account data
 */
export declare const checkDryingExistsOnSolana: (dryingId: any) => Promise<{
    exists: boolean;
    pda?: string;
    accountData?: any;
}>;
/**
 * Get a drying record from Solana
 * @param dryingId The drying ID to fetch
 * @returns Drying account data
 */
export declare const getDryingFromSolana: (dryingId: any) => Promise<any>;
/**
 * Update a drying record on Solana
 * @param dryingData Object containing drying_id and fields to update
 * @returns Transaction signature
 */
export declare const updateDryingOnSolana: (dryingData: any) => Promise<string>;
/**
 * Soft delete a drying record on Solana (set is_active = 0)
 * @param dryingData Object containing drying_id
 * @returns Transaction signature
 */
export declare const deleteDryingOnSolana: (dryingData: any) => Promise<string>;
/**
 * Close a drying account permanently (removes from blockchain, returns rent)
 * WARNING: This permanently deletes the account
 * @param dryingData Object containing drying_id
 * @returns Transaction signature
 */
export declare const closeDryingOnSolana: (dryingData: any) => Promise<string>;
/**
 * Submit a new milling record to Solana
 * @param millingData Object containing milling details
 * @returns Transaction signature
 */
export declare const submitMillingToSolana: (millingData: any) => Promise<string>;
/**
 * Check if a milling record exists on Solana
 * @param millingId The milling ID to check
 * @returns Object with exists flag and optional account data
 */
export declare const checkMillingExistsOnSolana: (millingId: any) => Promise<{
    exists: boolean;
    pda?: string;
    accountData?: any;
}>;
/**
 * Get a milling record from Solana
 * @param millingId The milling ID to fetch
 * @returns Milling account data
 */
export declare const getMillingFromSolana: (millingId: any) => Promise<any>;
/**
 * Update a milling record on Solana
 * Uses sentinel values: u64::MAX = no update, empty string = no update
 * @param millingData Object containing milling_id and fields to update
 * @returns Transaction signature
 */
export declare const updateMillingOnSolana: (millingData: any) => Promise<string>;
/**
 * Soft delete a milling record on Solana (set is_active = 0)
 * @param millingData Object containing milling_id
 * @returns Transaction signature
 */
export declare const deleteMillingOnSolana: (millingData: any) => Promise<string>;
/**
 * Close a milling account on Solana (permanently remove and return rent)
 * WARNING: This permanently deletes the account - use with caution
 * @param millingData Object containing milling_id
 * @returns Transaction signature
 */
export declare const closeMillingOnSolana: (millingData: any) => Promise<string>;
/**
 * Submit a new production season to Solana
 * @param seasonData Object containing season fields
 * @returns Transaction signature
 */
export declare const submitSeasonToSolana: (seasonData: any) => Promise<string>;
/**
 * Check if a production season exists on Solana
 * @param seasonId The season ID to check
 * @returns Object with exists flag and optional account data
 */
export declare const checkSeasonExistsOnSolana: (seasonId: any) => Promise<{
    exists: boolean;
    pda?: string;
    accountData?: any;
}>;
/**
 * Get a production season from Solana
 * @param seasonId The season ID to fetch
 * @returns Season account data
 */
export declare const getSeasonFromSolana: (seasonId: any) => Promise<any>;
/**
 * Update a production season on Solana
 * @param seasonData Object containing season_id and fields to update
 * @returns Transaction signature
 */
export declare const updateSeasonOnSolana: (seasonData: any) => Promise<string>;
/**
 * Soft delete a production season on Solana (set is_active = 0)
 * @param seasonData Object containing season_id
 * @returns Transaction signature
 */
export declare const deleteSeasonOnSolana: (seasonData: any) => Promise<string>;
/**
 * Close a season account permanently (removes from blockchain, returns rent)
 * WARNING: This permanently deletes the account
 * @param seasonData Object containing season_id
 * @returns Transaction signature
 */
export declare const closeSeasonOnSolana: (seasonData: any) => Promise<string>;
/**
 * Initialize the program (one-time setup)
 * Creates the ProgramConfig account with the fee payer as super_admin
 * @returns Transaction signature
 */
export declare const initializeProgramOnSolana: () => Promise<string>;
/**
 * Get program configuration and initialization status
 * @returns Object containing isInitialized, superAdmin, and initializedAt
 */
export declare const getProgramConfig: () => Promise<{
    isInitialized: boolean;
    superAdmin: string | null;
    initializedAt: number | null;
    configPda: string;
}>;
/**
 * Get the fee payer's public key (useful for admin verification)
 * @returns The fee payer's public key as a base58 string
 */
export declare const getFeePayerPublicKey: () => string;
/**
 * Close the program config (un-initialize the program)
 * Only the super_admin can do this
 * WARNING: For testing purposes only
 * @returns Transaction signature
 */
export declare const closeConfigOnSolana: () => Promise<string>;
/**
 * Submit a new transaction to Solana
 * @param transactionData Object containing transaction fields
 * @returns Transaction signature
 */
export declare const submitTransactionToSolana: (transactionData: any) => Promise<string>;
/**
 * Check if a transaction exists on Solana by nonce
 * @param nonce The nonce used to create the transaction (u8: 0-255)
 * @returns true if transaction exists, false otherwise
 */
export declare const checkTransactionExistsOnSolana: (nonce: number | string) => Promise<boolean>;
/**
 * Submit a new buyback agreement to Solana
 */
export declare const submitBuybackToSolana: (buybackData: any) => Promise<string>;
/**
 * Check if a buyback exists on Solana
 */
export declare const checkBuybackExistsOnSolana: (buybackId: any) => Promise<{
    exists: boolean;
    pda?: string;
    accountData?: any;
}>;
/**
 * Get a buyback from Solana
 */
export declare const getBuybackFromSolana: (buybackId: any) => Promise<any>;
/**
 * Update in-season tracking data for a buyback
 */
export declare const updateInSeasonOnSolana: (buybackData: any) => Promise<string>;
/**
 * Settle a buyback agreement with new status workflow
 * Supports: active → settled/to_settle/pay_later
 */
export declare const settleBuybackOnSolana: (buybackData: any) => Promise<string>;
/**
 * Update payment schedule for a pending buyback (to_settle or pay_later)
 */
export declare const updatePaymentScheduleOnSolana: (buybackData: any) => Promise<string>;
/**
 * Mark a pending buyback as settled (to_settle/pay_later → settled)
 */
export declare const markBuybackSettledOnSolana: (buybackData: any) => Promise<string>;
/**
 * Confirm payment for a settled buyback
 */
export declare const confirmBuybackPaymentOnSolana: (buybackData: any) => Promise<string>;
/**
 * Soft delete a buyback (set is_active = 0)
 */
export declare const deleteBuybackOnSolana: (buybackData: any) => Promise<string>;
/**
 * Close a buyback account (permanently remove, return rent)
 */
export declare const closeBuybackOnSolana: (buybackData: any) => Promise<string>;
//# sourceMappingURL=solanaService.d.ts.map