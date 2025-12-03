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
//# sourceMappingURL=solanaService.d.ts.map