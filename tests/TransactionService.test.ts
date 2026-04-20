import { jest } from "@jest/globals";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

const VALID_PK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

jest.unstable_mockModule("../src/config/solanaConfig.js", () => {
    const pubkey = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    return {
        feePayer: { publicKey: pubkey },
        wallet: { publicKey: pubkey },
        tracingProgram: {
            programId: pubkey,
            methods: {
                createTransaction: jest.fn().mockReturnThis(),
                addTransaction: jest.fn().mockReturnThis(),
                updateTransaction: jest.fn().mockReturnThis(),
            },
        },
        distributionProgram: {
            methods: {},
        },
        connection: {
            getAccountInfo: jest.fn(),
        },
        bridgeConfigPDA: pubkey,
        CORE_PROGRAM_ID: pubkey,
        TRACING_PROGRAM_ID: pubkey,
    };
});

const {
    submitTransactionToSolana,
    addTransactionToSolana,
    updateTransactionOnSolana,
} = await import("../src/services/TransactionService.js");
const { tracingProgram, connection, feePayer } =
    await import("../src/config/solanaConfig.js");

describe("TransactionService", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("should correctly derive PDA and submit a transaction", async () => {
        const txData = {
            nonce: 101,
            from_actor_id: "1",
            to_actor_id: "2",
            quantity: "100",
            unit_price: "10",
            batch_id: "1001",
        };

        (connection.getAccountInfo as any).mockResolvedValue(null);
        const mockRpc = jest.fn().mockResolvedValue("mock_tx_sig");
        (tracingProgram.methods.createTransaction as any).mockReturnValue({
            accounts: jest.fn().mockReturnThis(),
            signers: jest.fn().mockReturnThis(),
            rpc: mockRpc,
        });

        const txSig = await submitTransactionToSolana(txData);
        expect(txSig).toBe("mock_tx_sig");

        const nonceBN = new BN(101);
        const [expectedPDA] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("tx"),
                feePayer.publicKey.toBuffer(),
                Buffer.from(nonceBN.toArray("le", 4)),
            ],
            tracingProgram.programId,
        );

        const accountsMethod = (tracingProgram.methods.createTransaction as any)
            .mock.results[0].value.accounts;
        expect(accountsMethod).toHaveBeenCalledWith(
            expect.objectContaining({
                transaction: expectedPDA,
            }),
        );
    });

    it("should call addTransaction instruction with full data", async () => {
        const txData = {
            nonce: 101,
            status: 2,
            from_actor_id: "1",
            to_actor_id: "2",
            quantity: "100",
            batch_id: "1001",
        };
        const mockRpc = jest.fn().mockResolvedValue("mock_tx_sig");
        (tracingProgram.methods.addTransaction as any).mockReturnValue({
            accounts: jest.fn().mockReturnThis(),
            signers: jest.fn().mockReturnThis(),
            rpc: mockRpc,
        });

        const txSig = await addTransactionToSolana(txData);
        expect(txSig).toBe("mock_tx_sig");
        expect(tracingProgram.methods.addTransaction).toHaveBeenCalled();
    });
});
