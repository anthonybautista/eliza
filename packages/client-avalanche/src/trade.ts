import { IAgentRuntime, elizaLogger, generateObject, ModelClass, stringToUuid, Memory } from "@ai16z/eliza";
import { parseUnits, formatUnits, Address } from 'viem';
import { ClientBase } from "./base.js";
import { AvalancheConfig } from "./environment.js";
import {
    getWalletBalances,
    getShareMetrics,
    executeTrade,
    HistoryEntry,
    TradingDecision,
    isTradingDecision,
    tradingAnalysisTemplate,
    WalletBalances,
    ShareMetrics,
    TradeAction
} from "./tradeLogic/yorquant.js";

interface TradingState {
    balances: {
        avax: string;
        savax: string;
        yrt: string;
    };
    shares: {
        supply: string;
        price: string;
        trend: string;
        supplyChangePercent: string;
        priceChangePercent: string;
        lastCheck: string;
    };
    accounts: {
        trading: Address;
        shares: Address;
    };
}

const TRADING_ROOM = 'avalanche_trading_room';
const CACHE_KEYS = {
    TRADING_STATE: 'avalanche/trading_state',
    LAST_DECISION: 'avalanche/last_decision',
    LAST_EXECUTION: 'avalanche/last_execution',
    LAST_ERROR: 'avalanche/last_error'
} as const;

export class AvalancheTradeClient {
    private readonly client: ClientBase;
    private readonly runtime: IAgentRuntime;
    private readonly config: AvalancheConfig;
    private readonly minAvaxBalance: bigint;
    private readonly maxShares: bigint;
    private readonly tradeInterval: number;
    private readonly historyInterval: number;

    private sharesAccount!: Address;
    private tradingAccount!: Address;
    private isLoggingHistory: boolean = false;
    private isTrading: boolean = false;

    constructor(client: ClientBase, runtime: IAgentRuntime, config: AvalancheConfig) {
        this.client = client;
        this.runtime = runtime;
        this.config = config;
        this.minAvaxBalance = parseUnits(config.MIN_AVAX_BALANCE.toString(), 18);
        this.maxShares = BigInt(config.MAX_SHARES);
        this.tradeInterval = config.TRADE_INTERVAL_MINUTES * 60 * 1000;
        this.historyInterval = config.HISTORY_INTERVAL * 60 * 1000;
    }

    private async initializeAccounts(): Promise<void> {
        try {
            const [account] = await this.client.walletClient.getAddresses();
            this.tradingAccount = account;
            this.sharesAccount = this.config.SHARES_ACCOUNT as Address || account;

            elizaLogger.log(`Trading account initialized: ${this.tradingAccount}`);
            elizaLogger.log(`Shares account initialized: ${this.sharesAccount}`);
        } catch (error) {
            elizaLogger.error("Error initializing accounts:", error);
            throw new Error("Failed to initialize trading accounts");
        }
    }

    async start(): Promise<void> {
        try {
            await this.initializeAccounts();
            this.logConfiguration();

            // Start main loops with error boundaries
            this.startHistoryLogging();
            this.startTrading();
        } catch (error) {
            elizaLogger.error("Error starting trading client:", error);
            throw error;
        }
    }

    private logConfiguration(): void {
        elizaLogger.log("Starting Avalanche trading client...", {
            mode: this.config.PAPER_TRADE ? 'paper trading' : 'live trading',
            minAvaxBalance: formatUnits(this.minAvaxBalance, 18),
            maxShares: this.config.MAX_SHARES,
            historyInterval: this.historyInterval / (60 * 1000),
            tradeInterval: this.tradeInterval / (60 * 1000)
        });
    }

    private startHistoryLogging(): void {
        this.logHistoryLoop().catch(error => {
            elizaLogger.error("Fatal error in history logging loop:", error);
        });
    }

    private startTrading(): void {
        this.tradingLoop().catch(error => {
            elizaLogger.error("Fatal error in trading loop:", error);
        });
    }

    private async logHistoryLoop(): Promise<void> {
        if (this.isLoggingHistory) {
            elizaLogger.warn("History logging already in progress");
            return;
        }

        try {
            this.isLoggingHistory = true;
            await this.logMarketState();

            // Cleanup old history periodically
            if (this.shouldCleanupHistory()) {
                await this.cleanupOldHistory();
            }
        } catch (error) {
            elizaLogger.error("Error in history logging loop:", error);
        } finally {
            this.isLoggingHistory = false;
            this.scheduleNextHistoryUpdate();
        }
    }

    private shouldCleanupHistory(): boolean {
        return Math.random() < (this.historyInterval / (24 * 60 * 60 * 1000));
    }

    private scheduleNextHistoryUpdate(): void {
        const variation = Math.floor(Math.random() * 60000) - 30000; // ±30 seconds
        setTimeout(() => this.logHistoryLoop(), this.historyInterval + variation);
    }

    private async cleanupOldHistory(retentionDays: number = 30): Promise<void> {
        try {
            const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
            const oldMemories = await this.runtime.messageManager.getMemories({
                roomId: stringToUuid(TRADING_ROOM),
                start: 0,
                end: cutoffTime
            });

            const historyMemories = oldMemories.filter(m =>
                m.content.source === 'avalanche' && !m.content.action
            );

            for (const memory of historyMemories) {
                await this.runtime.messageManager.removeMemory(memory.id);
            }

            elizaLogger.log(`Cleaned up ${historyMemories.length} old history entries`);
        } catch (error) {
            elizaLogger.error("Error cleaning up old history:", error);
            throw error;
        }
    }

    private async tradingLoop(): Promise<void> {
        if (this.isTrading) {
            elizaLogger.warn("Trading operation already in progress");
            return;
        }

        try {
            this.isTrading = true;
            await this.checkStateAndTrade();
        } catch (error) {
            elizaLogger.error("Error in trading loop:", error);
            await this.logTradeError(error);
        } finally {
            this.isTrading = false;
            this.scheduleNextTrade();
        }
    }

    private scheduleNextTrade(): void {
        const variation = Math.floor(Math.random() * 60000) - 30000; // ±30 seconds
        setTimeout(() => this.tradingLoop(), this.tradeInterval + variation);
    }

    private async logTradeError(error: Error): Promise<void> {
        await this.runtime.cacheManager.set(
            CACHE_KEYS.LAST_ERROR,
            {
                timestamp: Date.now(),
                error: error.message,
                stack: error.stack
            },
            { expires: 24 * 60 * 60 * 1000 }
        );
    }

    private async getHistoryFromMemories(lookbackDays: number = 7): Promise<HistoryEntry[]> {
        const endTime = Date.now();
        const startTime = endTime - (lookbackDays * 24 * 60 * 60 * 1000);

        try {
            elizaLogger.log("Fetching history entries:", {
                startTime: new Date(startTime).toISOString(),
                endTime: new Date(endTime).toISOString(),
                lookbackDays
            });

            const memories = await this.runtime.messageManager.getMemories({
                roomId: stringToUuid(TRADING_ROOM),
                start: startTime,
                end: endTime
            });

            return this.processHistoryMemories(memories);
        } catch (error) {
            elizaLogger.error("Error retrieving history:", {
                error: this.formatError(error),
                lookbackDays,
                startTime,
                endTime
            });
            return [];
        }
    }

    private processHistoryMemories(memories: Memory[]): HistoryEntry[] {
        return memories
            .filter(memory => this.isValidHistoryMemory(memory))
            .map(memory => ({
                timestamp: memory.createdAt ?? Date.now(),
                price: String(memory.content.price), // Ensure price is a string
                supply: String(memory.content.supply) // Ensure supply is a string
            }))
            .sort((a, b) => a.timestamp - b.timestamp);
    }

    private isValidHistoryMemory(memory: Memory): memory is Memory & {
        content: { price: string | number; supply: string | number; source: 'avalanche' }
    } {
        if (memory.content.source !== 'avalanche' || memory.content.action) {
            return false;
        }

        const hasValidPrice =
            (typeof memory.content.price === 'string' || typeof memory.content.price === 'number') &&
            !isNaN(Number(memory.content.price));
        const hasValidSupply =
            (typeof memory.content.supply === 'string' || typeof memory.content.supply === 'number') &&
            !isNaN(Number(memory.content.supply));

        if (!hasValidPrice || !hasValidSupply) {
            elizaLogger.debug("Invalid memory format:", {
                id: memory.id,
                content: memory.content,
                hasValidPrice,
                hasValidSupply
            });
            return false;
        }

        return true;
    }


    private async logHistoryEntry(entry: HistoryEntry): Promise<boolean> {
        try {
            if (!this.isValidHistoryEntry(entry)) {
                elizaLogger.error("Invalid history entry:", entry);
                return false;
            }

            const memoryId = stringToUuid(`history-${entry.timestamp}`);
            if (await this.isDuplicateEntry(entry, memoryId)) {
                return false;
            }

            await this.createHistoryMemory(entry, `history-${entry.timestamp}`);

            return true;

        } catch (error) {
            elizaLogger.error("Error in logHistoryEntry:", {
                error: this.formatError(error),
                entry
            });
            return false;
        }
    }

    private isValidHistoryEntry(entry: HistoryEntry): boolean {
        return Boolean(
            entry &&
            typeof entry.timestamp === 'number' &&
            entry.price &&
            entry.supply &&
            !isNaN(parseFloat(entry.price)) &&
            !isNaN(parseFloat(entry.supply))
        );
    }

    private async isDuplicateEntry(entry: HistoryEntry, memoryId: string): Promise<boolean> {
        const existingMemories = await this.runtime.messageManager.getMemories({
            roomId: stringToUuid(TRADING_ROOM),
            start: entry.timestamp - 1000,
            end: entry.timestamp + 1000
        });

        return existingMemories.some(m =>
            m.id === memoryId &&
            m.content.source === 'avalanche'
        );
    }

    private async createHistoryMemory(entry: HistoryEntry, memoryId: string): Promise<void> {
        const memoryContent = {
            id: stringToUuid(memoryId),
            userId: this.runtime.agentId,
            agentId: this.runtime.agentId,
            content: {
                text: `Price: ${entry.price} AVAX, Supply: ${entry.supply}`,
                price: entry.price,
                supply: entry.supply,
                source: 'avalanche'
            },
            roomId: stringToUuid(TRADING_ROOM)
        };

        await this.runtime.messageManager.createMemory(memoryContent);
        elizaLogger.log("Successfully created history entry:", {
            id: memoryId,
            timestamp: entry.timestamp,
            price: entry.price,
            supply: entry.supply
        });
    }

    private formatError(error: unknown): Record<string, string> {
        if (error instanceof Error) {
            return {
                message: error.message,
                name: error.name,
                stack: error.stack ?? 'No stack trace'
            };
        }
        return { message: String(error) };
    }

    private async logMarketState(): Promise<void> {
        try {
            const balances = await getWalletBalances(this.client, this.tradingAccount);
            const history = await this.getHistoryFromMemories();
            const metrics = await getShareMetrics(this.client, this.sharesAccount, history);

            if (!this.validateMarketData(balances, metrics)) {
                elizaLogger.error("Failed to fetch valid market state data");
                return;
            }

            await this.logStateToMemory(balances, metrics, true);
        } catch (error) {
            elizaLogger.error("Error logging market state:", error);
            throw error;
        }
    }

    private validateMarketData(balances?: WalletBalances, metrics?: ShareMetrics): boolean {
        return Boolean(balances && metrics);
    }

    private async logStateToMemory(
        balances: WalletBalances,
        metrics: ShareMetrics,
        forceHistoryUpdate: boolean = false
    ): Promise<void> {
        const currentTime = Date.now();

        try {
            if (!balances.avax || !metrics.buyPrice) {
                throw new Error("Invalid balance or metrics data");
            }

            const state = this.createStateObject(balances, metrics, currentTime);
            await this.saveState(state);

            if (forceHistoryUpdate) {
                await this.updateHistoryWithCurrentState(metrics, currentTime);
            }
        } catch (error) {
            elizaLogger.error("Error logging state to memory:", error);
            throw error;
        }
    }

    private createStateObject(
        balances: WalletBalances,
        metrics: ShareMetrics,
        timestamp: number
    ): TradingState {
        return {
            balances: {
                avax: formatUnits(balances.avax, 18),
                savax: formatUnits(balances.savax, 18),
                yrt: formatUnits(balances.yrt, 18)
            },
            shares: {
                supply: metrics.supply.toString(),
                price: formatUnits(metrics.buyPrice, 18),
                trend: metrics.trend,
                supplyChangePercent: metrics.supplyChangePercent.toFixed(2),
                priceChangePercent: metrics.priceChangePercent.toFixed(2),
                lastCheck: new Date(timestamp).toISOString()
            },
            accounts: {
                trading: this.tradingAccount,
                shares: this.sharesAccount
            }
        };
    }

    private async saveState(state: TradingState): Promise<void> {
        await this.runtime.cacheManager.set(
            CACHE_KEYS.TRADING_STATE,
            state,
            { expires: 24 * 60 * 60 * 1000 }
        );
    }

    private async updateHistoryWithCurrentState(metrics: ShareMetrics, timestamp: number): Promise<void> {
        const newEntry: HistoryEntry = {
            timestamp,
            price: formatUnits(metrics.buyPrice, 18),
            supply: metrics.supply.toString()
        };

        const logged = await this.logHistoryEntry(newEntry);
        if (logged) {
            await this.logHistoryUpdate(newEntry);
        }
    }

    private async logHistoryUpdate(entry: HistoryEntry): Promise<void> {
        const recentHistory = await this.getHistoryFromMemories(1);
        elizaLogger.log("Market state logged:", {
            price: entry.price,
            supply: entry.supply,
            historyEntries: recentHistory.length,
            oldestEntry: recentHistory[0] ? new Date(recentHistory[0].timestamp).toISOString() : 'N/A',
            newestEntry: new Date(entry.timestamp).toISOString()
        });
    }

    private async checkStateAndTrade(): Promise<void> {
        try {
            elizaLogger.log("Checking market conditions for trading opportunity...");

            const balances = await getWalletBalances(this.client, this.tradingAccount);
            if (!this.hasMinimumBalance(balances)) {
                return;
            }

            const history = await this.getHistoryFromMemories();
            const metrics = await getShareMetrics(this.client, this.sharesAccount, history);

            if (!this.validateMetrics(metrics)) {
                return;
            }

            await this.logStateToMemory(balances, metrics);
            await this.evaluateAndTrade(balances, metrics, history);

        } catch (error) {
            elizaLogger.error("Error in trading loop:", error);
            await this.logTradeError(error as Error);
            throw error;
        }
    }

    private hasMinimumBalance(balances?: WalletBalances): boolean {
        if (!balances || balances.avax < this.minAvaxBalance) {
            elizaLogger.warn(`Insufficient AVAX balance:`, {
                current: balances ? formatUnits(balances.avax, 18) : '0',
                minimum: formatUnits(this.minAvaxBalance, 18)
            });
            return false;
        }
        return true;
    }

    private validateMetrics(metrics?: ShareMetrics): boolean {
        if (!metrics || (metrics.buyPrice === 0n && metrics.supply > 0n)) {
            elizaLogger.warn("Invalid share metrics received, skipping trade evaluation");
            return false;
        }
        return true;
    }

    private async evaluateAndTrade(
        balances: WalletBalances,
        metrics: ShareMetrics,
        history: HistoryEntry[]
    ): Promise<void> {
        const currentTime = Date.now();

        try {
            const decision = await this.generateTradingDecision(balances, metrics, history);
            if (!this.validateDecision(decision)) {
                return;
            }

            const decisionText = "Trading Analysis: " + JSON.stringify({
                action: decision.action,
                amount: decision.amount,
                reasoning: decision.reasoning,
                currentPrice: formatUnits(metrics.buyPrice, 18),
                currentTrend: metrics.trend,
                priceChange: metrics.priceChangePercent,
                supplyChange: metrics.supplyChangePercent
            })

            await this.runtime.logToFirebase('thoughts', decisionText, 'Trade');

            await this.executeDecision(decision, balances, metrics, currentTime);

        } catch (error) {
            await this.handleTradeError(error as Error, currentTime);
            throw error;
        }
    }

    private async generateTradingDecision(
        balances: WalletBalances,
        metrics: ShareMetrics,
        history: HistoryEntry[]
    ): Promise<TradingDecision> {
        try {
            const analysisContext = {
                balances: {
                    avax: formatUnits(balances.avax, 18),
                    savax: formatUnits(balances.savax, 18),
                    yrt: formatUnits(balances.yrt, 18)
                },
                metrics: {
                    supply: metrics.supply.toString(),
                    price: formatUnits(metrics.buyPrice, 18),
                    supplyChangePercent: metrics.supplyChangePercent.toFixed(2),
                    priceChangePercent: metrics.priceChangePercent.toFixed(2),
                    trend: metrics.trend,
                    lastCheck: new Date().toISOString(),
                    hoursSinceLastChange: 1
                },
                maxShares: this.maxShares.toString(),
                minAvaxBalance: formatUnits(this.minAvaxBalance, 18),
                tradingAccount: this.tradingAccount,
                sharesAccount: this.sharesAccount,
                priceHistory: history
                    .slice(-24)
                    .map(entry => `${new Date(entry.timestamp).toISOString()}: ${entry.price} AVAX`)
                    .join('\n')
            };

            const prompt = tradingAnalysisTemplate.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
                return key.split('.').reduce((obj: any, k: string) => obj?.[k.trim()], analysisContext) || match;
            });

            const decision = await generateObject({
                runtime: this.runtime,
                context: prompt,
                modelClass: ModelClass.SMALL
            });

            if (!this.validateDecision(decision)) {
                throw new Error('Invalid trading decision generated');
            }

            return decision;
        } catch (error) {
            elizaLogger.error("Error generating trading decision:", error);
            throw error;
        }
    }

    private async executeDecision(
        decision: TradingDecision,
        balances: WalletBalances,
        metrics: ShareMetrics,
        timestamp: number
    ): Promise<void> {
        if (decision.action === 'WAIT') {
            elizaLogger.log("Decision: WAIT -", decision.reasoning);
            await this.saveTradingDecision(decision, metrics, timestamp);
            return;
        }

        const tradeAction = await this.prepareTradeAction(decision, balances);
        if (!tradeAction) return;

        const success = await this.executeTrade(tradeAction, metrics);
        if (success) {
            await this.logSuccessfulTrade(decision, tradeAction, metrics, timestamp);
        }
    }

    private async executeTrade(tradeAction: TradeAction, metrics: ShareMetrics): Promise<boolean> {
        return executeTrade(
            this.client,
            tradeAction,
            this.sharesAccount,
            this.tradingAccount,
            this.config
        );
    }

    private async saveTradingDecision(
        decision: TradingDecision,
        metrics: ShareMetrics,
        timestamp: number
    ): Promise<void> {
        await this.runtime.cacheManager.set(
            CACHE_KEYS.LAST_DECISION,
            {
                timestamp,
                action: decision.action,
                amount: decision.amount,
                reasoning: decision.reasoning,
                metrics: {
                    price: formatUnits(metrics.buyPrice, 18),
                    supply: metrics.supply.toString(),
                    trend: metrics.trend,
                    priceChange: metrics.priceChangePercent,
                    supplyChange: metrics.supplyChangePercent
                }
            },
            { expires: 7 * 24 * 60 * 60 * 1000 }
        );
    }

    private async handleTradeError(error: Error, timestamp: number): Promise<void> {
        await this.runtime.cacheManager.set(
            CACHE_KEYS.LAST_EXECUTION,
            {
                timestamp,
                status: 'failed',
                error: error.message,
                stack: error.stack
            },
            { expires: 24 * 60 * 60 * 1000 }
        );
    }

    private validateDecision(decision: unknown): decision is TradingDecision {
        if (!isTradingDecision(decision)) {
            elizaLogger.error("Invalid trading decision format:", decision);
            return false;
        }
        return true;
    }

    private async prepareTradeAction(
        decision: TradingDecision,
        balances: WalletBalances
    ): Promise<TradeAction | null> {
        try {
            let tradeAmount: bigint;

            switch (decision.action) {
                case 'BUY_SHARES': {
                    const shareAmount = BigInt(decision.amount);
                    tradeAmount = shareAmount > this.maxShares ? this.maxShares : shareAmount;

                    if (shareAmount > this.maxShares) {
                        elizaLogger.warn(
                            `Reducing share purchase from ${shareAmount} to ${this.maxShares} due to maxShares limit`
                        );
                    }
                    break;
                }
                case 'STAKE_YAK': {
                    tradeAmount = parseUnits(decision.amount.toString(), 18);
                    if (tradeAmount > balances.avax) {
                        tradeAmount = balances.avax;
                        elizaLogger.warn(
                            `Reducing stake amount from ${formatUnits(parseUnits(decision.amount.toString(), 18), 18)} to ${formatUnits(balances.avax, 18)} AVAX due to insufficient balance`
                        );
                    }
                    break;
                }
                case 'WITHDRAW_AND_BUY': {
                    tradeAmount = parseUnits(decision.amount.toString(), 18);
                    if (tradeAmount > balances.yrt) {
                        tradeAmount = balances.yrt;
                        elizaLogger.warn(
                            `Reducing withdrawal from ${formatUnits(parseUnits(decision.amount.toString(), 18), 18)} to ${formatUnits(balances.yrt, 18)} YRT due to insufficient balance`
                        );
                    }
                    break;
                }
                default: {
                    elizaLogger.error(`Unknown action type: ${decision.action}`);
                    return null;
                }
            }

            return {
                type: decision.action,
                amount: tradeAmount,
                additionalInfo: `Reason: ${decision.reasoning}`
            };
        } catch (error) {
            elizaLogger.error("Error preparing trade action:", error);
            return null;
        }
    }

    private async logSuccessfulTrade(
        decision: TradingDecision,
        tradeAction: TradeAction,
        metrics: ShareMetrics,
        timestamp: number
    ): Promise<void> {
        const logAmount = decision.action === 'BUY_SHARES' ?
            tradeAction.amount.toString() :
            formatUnits(tradeAction.amount, 18);

        const logPrice = decision.action === 'BUY_SHARES' ?
            formatUnits(metrics.buyPrice, 18) :
            'N/A';

        await this.runtime.messageManager.createMemory({
            id: stringToUuid(`trade-${timestamp}`),
            userId: this.runtime.agentId,
            agentId: this.runtime.agentId,
            content: {
                text: `${decision.action}: ${logAmount} ${
                    decision.action === 'BUY_SHARES' ?
                    `shares at ${logPrice} AVAX` :
                    decision.action === 'STAKE_YAK' ? 'AVAX' : 'YRT'
                } - ${decision.reasoning}`,
                action: decision.action,
                amount: logAmount,
                price: logPrice,
                reasoning: decision.reasoning,
                source: 'avalanche'
            },
            roomId: stringToUuid(TRADING_ROOM)
        });
    }
}