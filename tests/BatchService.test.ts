import { jest } from "@jest/globals";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

const VALID_PK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

// Mocking the config module
jest.unstable_mockModule("../src/config/solanaConfig.js", () => {
    return {
        feePayer: {
            publicKey: new PublicKey(
                "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
            ),
        },
        wallet: {
            publicKey: new PublicKey(
                "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
            ),
        },
        tracingProgram: {
            methods: {
                createBatch: jest.fn().mockReturnThis(),
                updateBatch: jest.fn().mockReturnThis(),
                deleteBatch: jest.fn().mockReturnThis(),
                closeBatch: jest.fn().mockReturnThis(),
            },
            account: {
                batchAccount: {
                    fetch: jest.fn(),
                },
            },
        },
        connection: {
            getAccountInfo: jest.fn(),
        },
        bridgeConfigPDA: new PublicKey(
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        ),
        TRACING_PROGRAM_ID: new PublicKey(
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        ),
        CORE_PROGRAM_ID: new PublicKey(
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        ),
    };
});

// Import dynamically after mocking
const { submitBatchToSolana, checkBatchExistsOnSolana } =
    await import("../src/services/BatchService.js");
const { tracingProgram, connection, feePayer, TRACING_PROGRAM_ID } =
    await import("../src/config/solanaConfig.js");

describe("BatchService", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("should correctly derive PDA and submit a batch", async () => {
        const batchData = {
            batch_id: "1001",
            qr_code: "BATCH-1001",
            season_id: "1",
            current_holder_id: "10",
        };

        (connection.getAccountInfo as any).mockResolvedValue(null);

        const mockRpc = jest.fn().mockResolvedValue("mock_tx_sig");
        (tracingProgram.methods.createBatch as any).mockReturnValue({
            accounts: jest.fn().mockReturnThis(),
            signers: jest.fn().mockReturnThis(),
            rpc: mockRpc,
        });

        const txSig = await submitBatchToSolana(batchData);

        expect(txSig).toBe("mock_tx_sig");

        const batchIdBN = new BN("1001", 10);
        const [expectedPDA] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("batch"),
                feePayer.publicKey.toBuffer(),
                Buffer.from(batchIdBN.toArray("le", 4)),
            ],
            TRACING_PROGRAM_ID,
        );

        expect(tracingProgram.methods.createBatch).toHaveBeenCalled();

        const accountsMethod = (tracingProgram.methods.createBatch as any).mock
            .results[0].value.accounts;
        expect(accountsMethod).toHaveBeenCalledWith(
            expect.objectContaining({
                batch: expectedPDA,
            }),
        );
    });

    it("should return false if batch does not exist", async () => {
        (connection.getAccountInfo as any).mockResolvedValue(null);
        const exists = await checkBatchExistsOnSolana("1001");
        expect(exists).toBe(false);
    });
});
