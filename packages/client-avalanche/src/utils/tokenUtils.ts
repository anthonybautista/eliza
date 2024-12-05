import { Address } from 'viem';
import { ClientBase } from '../base.js';
import { elizaLogger } from '@ai16z/eliza';

export async function approve(client: ClientBase, tokenAddress: Address, spender: Address, amount: number) {
    try {
        // Simulate the approve transaction
        const approveRequest = await client.simulateContract({
            address: tokenAddress,
            abi: [{
                inputs: [
                    { internalType: "address", name: "_spender", type: "address" },
                    { internalType: "uint256", name: "_value", type: "uint256" }
                ],
                name: "approve",
                outputs: [{ internalType: "bool", name: "", type: "bool" }],
                stateMutability: "nonpayable",
                type: "function"
            }],
            functionName: 'approve',
            args: [spender, BigInt(amount)]
        });

        // Send the transaction
        const txHash = await client.sendTransaction(approveRequest);

        // Wait for the transaction receipt
        const receipt = await client.getTxReceipt(txHash);

        // Log the result and return success status
        if (receipt.status === "success") {
            elizaLogger.log(`Approval transaction succeeded: ${txHash}`);
            return true;
        } else {
            elizaLogger.error(`Approval transaction failed: ${txHash}`);
            return false;
        }
    } catch (error) {
        elizaLogger.error('Error in approve function:', error);
        return false;
    }
}


async function getDecimals(client: ClientBase, tokenAddress: Address) {
    if (tokenAddress === "0x0000000000000000000000000000000000000000") {
        return 18; // AVAX decimals
    }
    const decimals = await client.publicClient.readContract({
        address: tokenAddress,
        abi: [{
            "inputs": [],
            "name": "decimals",
            "outputs": [{ "internalType": "uint8", "name": "", "type": "uint8" }],
            "stateMutability": "view",
            "type": "function"
        }],
        functionName: 'decimals',
    });
    return decimals;
}

export const getTokenBalance = async (client: ClientBase, tokenAddress: Address) => {
    const balance = await client.publicClient.readContract({
        address: tokenAddress,
        abi: [{
            inputs: [{ name: "account", type: "address" }],
            name: "balanceOf",
            outputs: [{ name: "", type: "uint256" }],
            stateMutability: "view",
            type: "function"
        }],
        functionName: 'balanceOf',
        args: [client.account.address]
    }) as bigint;

    return balance;
}
