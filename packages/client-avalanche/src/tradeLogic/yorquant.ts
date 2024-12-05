import { Address, parseUnits, formatUnits } from 'viem';
import { ClientBase } from "..//base.js";
import { TOKENS } from '../utils/tokens.js';
import { elizaLogger } from "@ai16z/eliza";
import { approve, getTokenBalance } from "../utils/tokenUtils.js";
import { swapExactNativeForToken, swapExactTokenForNative } from '../utils/swap.js';
import { stakeInYieldYak, withdrawFromYieldYak } from '../utils/yak.js';
import { AvalancheConfig } from '../environment.js';

export interface WalletBalances {
    avax: bigint;
    savax: bigint;
    yrt: bigint;
}

export interface ShareMetrics {
    supply: bigint;
    buyPrice: bigint;
    trend: 'increasing' | 'decreasing' | 'stable';
    supplyChangePercent: number;
    priceChangePercent: number;
}

export type TradeActionType = 'BUY_SHARES' | 'STAKE_YAK' | 'WITHDRAW_AND_BUY';

export interface TradeAction {
    type: TradeActionType;
    amount: bigint;
    expectedOutput?: bigint;
    additionalInfo?: string;
}

export interface HistoryEntry {
    timestamp: number;
    price: string;
    supply: string;
}

export interface TradingDecision {
    action: TradeActionType | 'WAIT';
    amount: string | number;
    reasoning: string;
}

export function isTradingDecision(obj: any): obj is TradingDecision {
    const validActions: (TradeActionType | 'WAIT')[] = ['BUY_SHARES', 'STAKE_YAK', 'WITHDRAW_AND_BUY', 'WAIT'];
    return (
        typeof obj === 'object' &&
        validActions.includes(obj.action) &&
        (typeof obj.amount === 'string' || typeof obj.amount === 'number') &&
        (obj.action === 'WAIT' ? (obj.amount === 0 || obj.amount === "0") : true) &&
        typeof obj.reasoning === 'string'
    );
}

export const tradingAnalysisTemplate = `Current Market State:
- AVAX Balance: {{balances.avax}} AVAX
- sAVAX Balance: {{balances.savax}} sAVAX
- YRT Balance: {{balances.yrt}} YRT
- Share Supply: {{metrics.supply}}
- Share Price: {{metrics.price}} AVAX
- 1h Supply Change: {{metrics.supplyChangePercent}}%
- 1h Price Change: {{metrics.priceChangePercent}}%
- Current Trend: {{metrics.trend}}
- Hours Since Last Change: {{metrics.hoursSinceLastChange}}
- Last Check: {{metrics.lastCheck}}

Historical Context:
{{priceHistory}}

Strategy Parameters:
- Maximum Shares Per Trade: {{maxShares}}
- Minimum AVAX Balance: {{minAvaxBalance}} AVAX
- Trading Account: {{tradingAccount}}
- Shares Account: {{sharesAccount}}

Trading Strategy Goals:
1. Primary: Increase share price through strategic buy pressure
2. Secondary: Maximize yield on idle AVAX through YAK staking
3. Tertiary: Time purchases to maximize impact on price discovery

Key Strategy Points:
- Buying during periods of low activity can have outsized impact on price
- Staking excess AVAX provides yield while waiting for optimal entry
- Small, frequent buys can create sustained upward pressure
- Look for opportunities to lead price discovery higher
- Consider unstaking and buying when price shows weakness

Considering the above market conditions and strategy goals, recommend ONE of these actions:
1. BUY_SHARES: Purchase shares with available AVAX to create buy pressure
2. STAKE_YAK: Convert idle AVAX to YRT via WAVAX & sAVAX for yield farming
3. WITHDRAW_AND_BUY: Exit YRT position to buy shares (effective after price drops)
4. WAIT: Hold current position (use amount: "0")

Be aggressive in identifying opportunities to increase price through well-timed buys.
Consider staking when no immediate buying opportunity exists to earn yield.
Look for chances to establish new local highs through strategic buying.

Respond with a JSON object containing:
- action: The recommended action (one of the above)
- amount: The numeric amount to trade:
  - For BUY_SHARES: Number of shares (must be positive whole number)
  - For STAKE_YAK: Amount of AVAX to stake (must be positive number)
  - For WITHDRAW_AND_BUY: Amount of YRT to withdraw (must be positive number)
  - For WAIT: Use "0"
- reasoning: A brief explanation focusing on price impact and strategy`;

export async function getWalletBalances(
    client: ClientBase,
    tradingAccount: Address
): Promise<WalletBalances> {
    const balances = {
        avax: await client.publicClient.getBalance({
            address: tradingAccount
        }),
        savax: await getTokenBalance(client, TOKENS.SAVAX.address as `0x${string}`),
        yrt: await getTokenBalance(client, TOKENS.YRT_BENQI_SAVAX.address as `0x${string}`)
    };

    return balances;
}

export async function getShareMetrics(
    client: ClientBase,
    sharesAccount: Address,
    history: HistoryEntry[]
): Promise<ShareMetrics> {
    try {
        const supply = await client.publicClient.readContract({
            address: TOKENS.ARENA.address as Address,
            abi: [{
                inputs: [{ name: "sharesSubject", type: "address" }],
                name: "getSharesSupply",
                outputs: [{ name: "", type: "uint256" }],
                stateMutability: "view",
                type: "function"
            }],
            functionName: 'getSharesSupply',
            args: [sharesAccount]
        }) as bigint;

        let buyPrice = 0n;


        try {
            buyPrice = await client.publicClient.readContract({
                address: TOKENS.ARENA.address as Address,
                abi: [{
                    inputs: [
                        { name: "sharesSubject", type: "address" },
                        { name: "amount", type: "uint256" }
                    ],
                    name: "getBuyPriceAfterFee",
                    outputs: [{ name: "", type: "uint256" }],
                    stateMutability: "view",
                    type: "function"
                }],
                functionName: 'getBuyPriceAfterFee',
                args: [sharesAccount, 1n]
            }) as bigint;
        } catch (error) {
            elizaLogger.warn(`Price fetch failed with 1 share`);
        }


        if (buyPrice === 0n && supply > 0n) {
            elizaLogger.error("Failed to fetch valid buy price");
            return {
                supply,
                buyPrice: 0n,
                trend: 'stable',
                supplyChangePercent: 0,
                priceChangePercent: 0
            };
        }

        let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
        let supplyChangePercent = 0;
        let priceChangePercent = 0;

        if (history.length > 0) {
            const oneHourAgo = Date.now() - (60 * 60 * 1000);
            const sortedHistory = [...history].sort((a, b) =>
                Math.abs(a.timestamp - oneHourAgo) - Math.abs(b.timestamp - oneHourAgo)
            );

            const hourlyEntry = sortedHistory[0];
            const entryAge = Date.now() - hourlyEntry.timestamp;

            if (entryAge >= 45 * 60 * 1000 && entryAge <= 75 * 60 * 1000) {
                const prevSupply = BigInt(hourlyEntry.supply);
                if (prevSupply > 0n) {
                    const supplyDiff = supply - prevSupply;
                    supplyChangePercent = Number((supplyDiff * 10000n) / prevSupply) / 100;
                }

                const prevPrice = parseUnits(hourlyEntry.price, 18);
                if (prevPrice > 0n) {
                    const priceDiff = buyPrice - prevPrice;
                    priceChangePercent = Number((priceDiff * 10000n) / prevPrice) / 100;
                }

                if (Math.abs(priceChangePercent) > 0.5 || Math.abs(supplyChangePercent) > 0) {
                    trend = priceChangePercent > 0 ? 'increasing' : 'decreasing';
                }
            }
        }

        return {
            supply,
            buyPrice,
            trend,
            supplyChangePercent,
            priceChangePercent
        };
    } catch (error) {
        elizaLogger.error("Error fetching share metrics:", error);
        return {
            supply: 0n,
            buyPrice: 0n,
            trend: 'stable',
            supplyChangePercent: 0,
            priceChangePercent: 0
        };
    }
}

export async function executeTrade(
    client: ClientBase,
    action: TradeAction,
    sharesAccount: Address,
    tradingAccount: Address,
    config: AvalancheConfig
): Promise<boolean> {
    // Format AVAX/token amounts for logging, but keep share amounts as whole numbers
    const logAmount = action.type === 'BUY_SHARES' ?
        action.amount.toString() :
        formatUnits(action.amount, 18);

    const logOutput = action.expectedOutput ?
        (action.type === 'BUY_SHARES' ?
            action.expectedOutput.toString() :
            formatUnits(action.expectedOutput, 18))
        : 'N/A';

    if (config.PAPER_TRADE) {
        elizaLogger.log(`[PAPER TRADE] Would execute: ${action.type}`, {
            amount: logAmount,
            expectedOutput: logOutput,
            additionalInfo: action.additionalInfo,
            tradingAccount,
            sharesAccount
        });
        return true;
    }

    try {
        switch (action.type) {
            case 'BUY_SHARES': {
                const buyPrice = await client.publicClient.readContract({
                    address: TOKENS.ARENA.address as Address,
                    abi: [{
                        inputs: [
                            { name: "sharesSubject", type: "address" },
                            { name: "amount", type: "uint256" }
                        ],
                        name: "getBuyPriceAfterFee",
                        outputs: [{ name: "", type: "uint256" }],
                        stateMutability: "view",
                        type: "function"
                    }],
                    functionName: 'getBuyPriceAfterFee',
                    args: [sharesAccount, action.amount]
                }) as bigint;

                elizaLogger.log(`TRYING TO BUY WITH PRICE ${buyPrice}`)

                const request = await client.simulateContract({
                    address: TOKENS.ARENA.address as Address,
                    abi: [{
                        inputs: [
                            { name: "sharesSubject", type: "address" },
                            { name: "amount", type: "uint256" }
                        ],
                        name: "buyShares",
                        outputs: [],
                        stateMutability: "payable",
                        type: "function"
                    }],
                    functionName: 'buyShares',
                    args: [sharesAccount, action.amount],
                    value: buyPrice
                });

                const hash = await client.sendTransaction(request);
                const receipt = await client.getTxReceipt(hash);

                return receipt.status === "success";
            }

            case 'STAKE_YAK': {
                try {
                    // First swap to sAVAX
                    await swapExactNativeForToken(TOKENS.SAVAX, action.amount.toString(), "100", config);
                    elizaLogger.log("swapExactNativeForToken completed.");
                    // Get sAVAX balance
                    const sAvaxBalance = await getTokenBalance(client, TOKENS.SAVAX.address as `0x${string}`);
                    elizaLogger.log("sAvaxBalance:", sAvaxBalance);
                    // Deposit sAVAX into YRT
                    const success = await stakeInYieldYak(client, sAvaxBalance, TOKENS.YRT_BENQI_SAVAX.address as `0x${string}`, TOKENS.SAVAX.address as `0x${string}`);
                    elizaLogger.log("stakeInYieldYak success:", success);
                    return success;
                } catch (error) {
                    elizaLogger.error(`Failed to execute ${action.type}:`, error);
                    return false;
                }
            }

            case 'WITHDRAW_AND_BUY': {
                try {
                    // Withdraw from YRT
                    const success = await withdrawFromYieldYak(client, action.amount, TOKENS.YRT_BENQI_SAVAX.address as `0x${string}`);
                    elizaLogger.log("withdrawFromYieldYak:", success);
                    // Get resulting sAVAX balance
                    const sAvaxBalance = await getTokenBalance(client, TOKENS.SAVAX.address as `0x${string}`);
                    elizaLogger.log("sAvaxBalance:", sAvaxBalance);
                    // Swap back to native
                    await swapExactTokenForNative(TOKENS.SAVAX, sAvaxBalance.toString(), "100", config, client);
                    elizaLogger.log("swapExactTokenForNative completed.");
                    const buyPrice = await client.publicClient.readContract({
                        address: TOKENS.ARENA.address as Address,
                        abi: [{
                            inputs: [
                                { name: "sharesSubject", type: "address" },
                                { name: "amount", type: "uint256" }
                            ],
                            name: "getBuyPriceAfterFee",
                            outputs: [{ name: "", type: "uint256" }],
                            stateMutability: "view",
                            type: "function"
                        }],
                        functionName: 'getBuyPriceAfterFee',
                        args: [sharesAccount, 1n]
                    }) as bigint;
                    elizaLogger.log("Buy Price: ", buyPrice);
                    // Buy shares with unwrapped AVAX
                    const shareRequest = await client.simulateContract({
                        address: TOKENS.ARENA.address as Address,
                        abi: [{
                            inputs: [
                                { name: "sharesSubject", type: "address" },
                                { name: "amount", type: "uint256" }
                            ],
                            name: "buyShares",
                            outputs: [],
                            stateMutability: "payable",
                            type: "function"
                        }],
                        functionName: 'buyShares',
                        args: [sharesAccount, 1n],
                        value: buyPrice
                    });

                    const shareHash = await client.sendTransaction(shareRequest);
                    const shareReceipt = await client.getTxReceipt(shareHash);
                    elizaLogger.log("buyShares success:", shareReceipt.status);
                    return shareReceipt.status === "success";
                } catch (error) {
                    elizaLogger.error(`Failed to execute ${action.type}:`, error);
                    return false;
                }

            }
        }

        return false;
    } catch (error) {
        elizaLogger.error(`Failed to execute ${action.type}:`, error);
        return false;
    }
}
