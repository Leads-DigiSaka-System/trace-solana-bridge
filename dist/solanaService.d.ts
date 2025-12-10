export declare const checkProgramInitialization: () => Promise<boolean>;
export declare const submitActorToSolana: (actorData: any) => Promise<string>;
/**
 * Check if an actor account exists on Solana
 * @param actorId The actor ID to check
 * @returns true if actor exists, false otherwise
 */
export declare const checkActorExistsOnSolana: (actorId: number) => Promise<boolean>;
/**
 * Update an existing actor on Solana
 * @param actorData Object containing actor_id and optional fields to update
 * @returns Transaction signature
 */
export declare const updateActorOnSolana: (actorData: any) => Promise<string>;
export declare const deleteActorOnSolana: (actorData: any) => Promise<string>;
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