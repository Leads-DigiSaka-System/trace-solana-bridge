import type { SolanaNetwork } from "../config/outboundWorkerConfig.js";

export interface OutboundItem {
    id: number;
    domain: string;
    subject_id: number;
    version: number;
    previous_hash: string | null;
    payload_hash: string;
    memo_format: "v1" | "v2";
    memo_hash: string | null;
    payload_uri: string;
    recovery_only: boolean;
    created_at: string | null;
}

export interface AnchorReceipt {
    signature: string;
    slot: number;
    source: "journal" | "reconciled" | "submitted";
}

export interface FailureDetails {
    code: string;
    message: string;
    retry: boolean;
}

export interface PendingItemError {
    id: number | null;
    index: number;
    message: string;
    retryable: boolean;
}

export interface PendingBatch {
    items: OutboundItem[];
    rejected: PendingItemError[];
}

export interface PreparedAnchor {
    network: SolanaNetwork;
    signature: string;
    raw_transaction_base64: string;
    blockhash: string;
    last_valid_block_height: number;
    submitted_at: string;
}

export interface JournalRecord {
    /** Optional only so legacy on-disk records can be retained and quarantined. */
    network?: SolanaNetwork;
    /** Private callback metadata for v2 hash-only public memos. */
    outbound_id?: number;
    payload_hash?: string;
    memo_hash?: string | undefined;
    memo: string;
    signature: string;
    slot: number | null;
    finalized_at: string | null;
    anchor_address?: string;
    submitted_at?: string;
    raw_transaction_base64?: string;
    blockhash?: string;
    last_valid_block_height?: number;
}
