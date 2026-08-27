import { LaravelApiError } from "../src/services/LaravelOutboundClient.js";
import { tripFundingCircuitIfNeeded } from "../src/worker.js";
import { classifyWorkerError } from "../src/worker/errors.js";

describe("worker error classification", () => {
    it("marks configuration and authorization responses as terminal", () => {
        expect(classifyWorkerError(new LaravelApiError("network mismatch", 409, false))).toEqual({
            code: "laravel_http_409",
            message: "network mismatch",
            retry: false,
        });
    });

    it("keeps transient Laravel failures retryable", () => {
        expect(classifyWorkerError(new LaravelApiError("unavailable", 503, true))).toEqual({
            code: "laravel_http_503",
            message: "unavailable",
            retry: true,
        });
    });

    it("opens the worker-wide circuit only for the exact insufficient-funds class", () => {
        expect(() =>
            tripFundingCircuitIfNeeded({
                code: "insufficient_funds",
                message: "Fee payer has insufficient funds",
                retry: true,
            }),
        ).toThrow(expect.objectContaining({
            code: "fee_payer_funding_circuit_open",
            retryable: false,
        }));

        expect(() =>
            tripFundingCircuitIfNeeded({
                code: "invalid_outbound_item",
                message: "Malformed row",
                retry: false,
            }),
        ).not.toThrow();
    });

    it("prevents a batch from proceeding to another row once funding is exhausted", () => {
        const processed: number[] = [];

        expect(() => {
            processed.push(1);
            tripFundingCircuitIfNeeded({
                code: "insufficient_funds",
                message: "Fee payer has insufficient funds",
                retry: true,
            });
            processed.push(2);
        }).toThrow(expect.objectContaining({ code: "fee_payer_funding_circuit_open" }));

        expect(processed).toEqual([1]);
    });
});
