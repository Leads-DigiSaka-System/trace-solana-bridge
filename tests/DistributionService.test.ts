import { jest } from "@jest/globals";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

jest.unstable_mockModule("../src/config/solanaConfig.js", () => {
    const pubkey = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    return {
        feePayer: { publicKey: pubkey },
        wallet: { publicKey: pubkey },
        distributionProgram: {
            methods: {
                submitActorPerformance: jest.fn().mockReturnThis(),
                recordDeliveryPerformance: jest.fn().mockReturnThis(),
                submitDistribution: jest.fn().mockReturnThis(),
                addCheckpoint: jest.fn().mockReturnThis(),
            },
        },
        distributionBridgeConfigPDA: pubkey,
        DISTRIBUTION_PROGRAM_ID: pubkey,
        CORE_PROGRAM_ID: pubkey,
    };
});

const {
    submitActorPerformanceToSolana,
    submitDistributionToSolana,
    submitCheckpointToSolana,
} = await import("../src/services/DistributionService.js");
const { distributionProgram, DISTRIBUTION_PROGRAM_ID } =
    await import("../src/config/solanaConfig.js");

describe("DistributionService", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("should correctly submit actor performance", async () => {
        const data = { actor_id: "123", performance_score: 95 };
        const mockRpc = jest.fn().mockResolvedValue("mock_tx_sig");
        (
            distributionProgram.methods.submitActorPerformance as any
        ).mockReturnValue({
            accounts: jest.fn().mockReturnThis(),
            signers: jest.fn().mockReturnThis(),
            rpc: mockRpc,
        });

        const txSig = await submitActorPerformanceToSolana(data);
        expect(txSig).toBe("mock_tx_sig");

        const actorIdBN = new BN("123", 10);
        const [expectedPerformancePDA] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("performance"),
                Buffer.from(actorIdBN.toArray("le", 8)),
            ],
            DISTRIBUTION_PROGRAM_ID,
        );

        const accountsMethod = (
            distributionProgram.methods.submitActorPerformance as any
        ).mock.results[0].value.accounts;
        expect(accountsMethod).toHaveBeenCalledWith(
            expect.objectContaining({
                performance: expectedPerformancePDA,
            }),
        );
    });

    it("should correctly submit distribution", async () => {
        const data = {
            distribution_id: "5001",
            batch_id: "1001",
            sender_id: "1",
            receiver_id: "2",
        };
        const mockRpc = jest.fn().mockResolvedValue("mock_tx_sig");
        (distributionProgram.methods.submitDistribution as any).mockReturnValue(
            {
                accounts: jest.fn().mockReturnThis(),
                signers: jest.fn().mockReturnThis(),
                rpc: mockRpc,
            },
        );

        const txSig = await submitDistributionToSolana(data);
        expect(txSig).toBe("mock_tx_sig");
        expect(
            distributionProgram.methods.submitDistribution,
        ).toHaveBeenCalled();
    });

    it("should correctly submit checkpoint", async () => {
        const data = {
            checkpoint_id: "8001",
            distribution_id: "5001",
            location: "Warehouse A",
        };
        const mockRpc = jest.fn().mockResolvedValue("mock_tx_sig");
        (distributionProgram.methods.addCheckpoint as any).mockReturnValue({
            accounts: jest.fn().mockReturnThis(),
            signers: jest.fn().mockReturnThis(),
            rpc: mockRpc,
        });

        const txSig = await submitCheckpointToSolana(data);
        expect(txSig).toBe("mock_tx_sig");
        expect(distributionProgram.methods.addCheckpoint).toHaveBeenCalled();
    });
});
