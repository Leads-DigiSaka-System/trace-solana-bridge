import { jest } from "@jest/globals";
import { PublicKey } from "@solana/web3.js";

const VALID_PK = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const mockGetAccountInfo = jest.fn();
const mockGetSignaturesForAddress = jest.fn();
const mockClusterFetch = jest.fn();
const mockCreateClusterRpc = jest.fn();

jest.unstable_mockModule("../src/config/solanaConfig.js", () => {
    const pubkey = new PublicKey(VALID_PK);
    return {
        feePayer: { publicKey: pubkey },
        wallet: { publicKey: pubkey },
        coreProgram: {
            provider: {
                connection: {
                    getAccountInfo: mockGetAccountInfo,
                    getSignaturesForAddress: mockGetSignaturesForAddress,
                },
            },
            account: {
                clusterAccount: {
                    fetch: mockClusterFetch,
                },
            },
            methods: {
                createCluster: jest.fn().mockReturnThis(),
            },
        },
        bridgeConfigPDA: pubkey,
        CORE_PROGRAM_ID: pubkey,
    };
});

const { submitClusterToSolana } =
    await import("../src/services/ClusterService.js");
const { coreProgram } = await import("../src/config/solanaConfig.js");

describe("ClusterService", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetAccountInfo.mockResolvedValue(null);
        mockCreateClusterRpc.mockResolvedValue("mock_tx_sig");
        (coreProgram.methods.createCluster as any).mockReturnValue({
            accounts: jest.fn().mockReturnThis(),
            signers: jest.fn().mockReturnThis(),
            rpc: mockCreateClusterRpc,
        });
    });

    it("creates a cluster when the PDA does not exist", async () => {
        const result = await submitClusterToSolana({
            cluster_id: "1750000001",
            name: "Cluster A",
            province: "Laguna",
            city: "Calamba",
        });

        expect(result).toEqual({ transaction_signature: "mock_tx_sig" });
        expect(coreProgram.methods.createCluster).toHaveBeenCalled();
    });

    it("throws STALE_PDA when the cluster account already exists on-chain", async () => {
        mockGetAccountInfo.mockResolvedValue({ data: Buffer.alloc(1) });
        mockClusterFetch.mockResolvedValue({ clusterId: "1750000001" });

        await expect(
            submitClusterToSolana({
                cluster_id: "1750000001",
                name: "Cluster A",
            }),
        ).rejects.toThrow("[STALE_PDA]");
    });

    it("returns already_exists when the PDA exists but fetch fails", async () => {
        mockGetAccountInfo.mockResolvedValue({ data: Buffer.alloc(1) });
        mockClusterFetch.mockRejectedValue(new Error("RPC unavailable"));
        mockGetSignaturesForAddress.mockResolvedValue([
            { signature: "existing_sig" },
        ]);

        const result = await submitClusterToSolana({
            cluster_id: "1750000001",
            name: "Cluster A",
        });

        expect(result).toEqual({
            transaction_signature: "existing_sig",
            already_exists: true,
        });
        expect(coreProgram.methods.createCluster).not.toHaveBeenCalled();
    });
});
