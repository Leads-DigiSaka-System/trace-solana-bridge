import { jest } from "@jest/globals";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

const VALID_PK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

jest.unstable_mockModule("../src/config/solanaConfig.js", () => {
    const pubkey = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    return {
        feePayer: { publicKey: pubkey },
        wallet: { publicKey: pubkey },
        coreProgram: {
            provider: {
                connection: {
                    getAccountInfo: jest.fn().mockResolvedValue(null),
                },
            },
            methods: {
                createOrganization: jest.fn().mockReturnThis(),
                registerValidator: jest.fn().mockReturnThis(),
                createCluster: jest.fn().mockReturnThis(),
            },
        },
        bridgeConfigPDA: pubkey,
        CORE_PROGRAM_ID: pubkey,
    };
});

const { submitOrganizationToSolana } =
    await import("../src/services/OrganizationService.js");
const { registerValidatorOnSolana } =
    await import("../src/services/ValidatorService.js");
const { submitClusterToSolana } =
    await import("../src/services/ClusterService.js");
const { coreProgram, CORE_PROGRAM_ID } =
    await import("../src/config/solanaConfig.js");

describe("Core Services", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("should correctly submit an organization", async () => {
        const data = { org_id: "1", name: "Test Org" };
        const mockRpc = jest.fn().mockResolvedValue("mock_tx_sig");
        (coreProgram.methods.createOrganization as any).mockReturnValue({
            accounts: jest.fn().mockReturnThis(),
            signers: jest.fn().mockReturnThis(),
            rpc: mockRpc,
        });

        const txSig = await submitOrganizationToSolana(data);
        expect(txSig).toBe("mock_tx_sig");
        expect(coreProgram.methods.createOrganization).toHaveBeenCalled();
    });

    it("should correctly register a validator", async () => {
        const data = { validator_id: "101", name: "Validator 1" };
        const mockRpc = jest.fn().mockResolvedValue("mock_tx_sig");
        (coreProgram.methods.registerValidator as any).mockReturnValue({
            accounts: jest.fn().mockReturnThis(),
            signers: jest.fn().mockReturnThis(),
            rpc: mockRpc,
        });

        const txSig = await registerValidatorOnSolana(data);
        expect(txSig).toBe("mock_tx_sig");
        expect(coreProgram.methods.registerValidator).toHaveBeenCalled();
    });

    it("should correctly submit a cluster", async () => {
        const data = { cluster_id: "501", name: "Cluster A" };
        const mockRpc = jest.fn().mockResolvedValue("mock_tx_sig");
        (coreProgram.methods.createCluster as any).mockReturnValue({
            accounts: jest.fn().mockReturnThis(),
            signers: jest.fn().mockReturnThis(),
            rpc: mockRpc,
        });

        const result = await submitClusterToSolana(data);
        expect(result.transaction_signature).toBe("mock_tx_sig");
        expect(coreProgram.methods.createCluster).toHaveBeenCalled();
    });
});
