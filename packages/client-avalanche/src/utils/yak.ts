import { approve } from './tokenUtils.js';
import { ClientBase } from '../base.js';
import { elizaLogger } from '@ai16z/eliza';

export async function stakeInYieldYak(
    client: ClientBase,
    amount: bigint,
    yakAddress: `0x${string}`,
    tokenAddress: `0x${string}`,
): Promise<boolean> {
    try {
        // Approve YRT for sAVAX
        const approveYrtHash = await approve(
            client,
            tokenAddress,
            yakAddress,
            Number(amount)
        );
        if (!approveYrtHash) return false;

        // sAVAX into YRT
        const depositRequest = await client.simulateContract({
            address: yakAddress,
            abi: [{
                inputs: [{ name: "_amount", type: "uint256" }],
                name: "deposit",
                outputs: [],
                stateMutability: "nonpayable",
                type: "function"
            }],
            functionName: 'deposit',
            args: [amount]
        });

        const depositHash = await client.sendTransaction(depositRequest);
        const depositReceipt = await client.getTxReceipt(depositHash);

        return depositReceipt.status === "success";
    } catch (error) {
        elizaLogger.error("Failed to stake in Yield Yak:", error);
        return false;
    }
}

export async function withdrawFromYieldYak(
    client: ClientBase,
    amount: bigint,
    yakAddress: `0x${string}`
): Promise<boolean> {
    try {
        // Withdraw from Yak
        const withdrawRequest = await client.simulateContract({
            address: yakAddress,
            abi: [{
                inputs: [{ name: "amount", type: "uint256" }],
                name: "withdraw",
                outputs: [],
                stateMutability: "nonpayable",
                type: "function"
            }],
            functionName: 'withdraw',
            args: [amount]
        });

        const withdrawHash = await client.sendTransaction(withdrawRequest);
        const withdrawReceipt = await client.getTxReceipt(withdrawHash);

        return withdrawReceipt.status === "success";
    } catch (error) {
        elizaLogger.error("Failed to stake in Yield Yak:", error);
        return false;
    }
}