import { LaravelApiError } from "../services/LaravelOutboundClient.js";
import { SolanaAnchorError } from "../services/SolanaMemoAnchorService.js";
import type { FailureDetails } from "./types.js";

export function classifyWorkerError(error: unknown): FailureDetails {
    if (error instanceof SolanaAnchorError) {
        return {
            code: error.code,
            message: error.message,
            retry: error.retryable,
        };
    }
    if (error instanceof LaravelApiError) {
        return {
            code: error.status === 0 ? "laravel_network_error" : `laravel_http_${error.status}`,
            message: error.message,
            retry: error.retryable,
        };
    }
    const message = error instanceof Error ? error.message : "Unexpected worker error";
    const normalized = message.toLowerCase();
    const permanent =
        normalized.includes("payload hash") ||
        normalized.includes("previous hash") ||
        normalized.includes("unsupported characters") ||
        normalized.includes("positive safe integer") ||
        normalized.includes("safety limit");
    return {
        code: permanent ? "invalid_outbound_item" : "worker_error",
        message: message.slice(0, 1_000),
        retry: !permanent,
    };
}
