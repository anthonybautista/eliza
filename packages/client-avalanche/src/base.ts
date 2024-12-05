import { IAgentRuntime, elizaLogger } from "@ai16z/eliza";
import { createPublicClient, createWalletClient, http, Account, WalletClient, Hash } from 'viem';
import { avalanche } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { EventEmitter } from 'events';

export class ClientBase extends EventEmitter {
    runtime: IAgentRuntime;
    publicClient = createPublicClient({
        chain: avalanche,
        transport: http()
    });
    walletClient: WalletClient;
    account: Account;

    constructor(runtime: IAgentRuntime) {
        super();
        this.runtime = runtime;

        // Ensure private key exists
        const privateKey = this.runtime.getSetting("AVALANCHE_PRIVATE_KEY");
        if (!privateKey) {
            throw new Error('AVALANCHE_PRIVATE_KEY not found in environment variables');
        }

        // Create account from private key
        this.account = privateKeyToAccount(`0x${privateKey.replace('0x', '')}`)

        // Create wallet client
        this.walletClient = createWalletClient({
            account: this.account,
            chain: avalanche,
            transport: http()
        })
    }

    async init() {
        try {
            // Verify connection and account
            const balance = await this.publicClient.getBalance({
                address: this.account.address
            });

            elizaLogger.log(`Initialized Avalanche client for address ${this.account.address}`);
            elizaLogger.log(`Current balance: ${balance.toString()}`);

            return true;
        } catch (error) {
            elizaLogger.error("Failed to initialize Avalanche client:", error);
            throw error;
        }
    }

    async getTxReceipt(tx: Hash) {
        const receipt = await this.publicClient.waitForTransactionReceipt({
            hash: tx
        });
        return receipt;
    }

    async simulateContract(params: {
        address: `0x${string}`;
        abi: any[];
        functionName: string;
        args: any[];
        value?: bigint;
    }): Promise<any> {
        const { request } = await this.publicClient.simulateContract({
            ...params,
            account: this.account
        });
        return request;
    }

    async sendTransaction(request: any) {
        try {
            const hash = await this.walletClient.writeContract(request);
            elizaLogger.log("Transaction sent:", hash);
            return hash;
        } catch (error) {
            elizaLogger.error("Transaction failed:", error);
            throw error;
        }
    }
}