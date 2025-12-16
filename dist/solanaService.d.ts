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
//# sourceMappingURL=solanaService.d.ts.map