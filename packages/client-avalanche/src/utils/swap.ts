import {
    ChainId,
    WNATIVE,
    Token,
    TokenAmount,
    Percent,
} from "@traderjoe-xyz/sdk-core";

import {
    PairV2,
    RouteV2,
    TradeV2,
    LB_ROUTER_V22_ADDRESS,
    jsonAbis,
} from "@traderjoe-xyz/sdk-v2";

import {
    createPublicClient,
    createWalletClient,
    http,
    PublicClient,
} from 'viem';

import { privateKeyToAccount } from "viem/accounts";
import { avalanche } from "viem/chains";
import { AvalancheConfig } from "../environment.js";
import { elizaLogger } from "@ai16z/eliza";
import { ClientBase } from '../base.js';
import { approve } from "./tokenUtils.js";

// ERC20 ABI for totalSupply function
const ERC20_ABI = [
    {
        "constant": true,
        "inputs": [],
        "name": "totalSupply",
        "outputs": [{"name": "", "type": "uint256"}],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
    }
];

export const swapExactNativeForToken = async (token: Token, inputAmount: string, slippage: string, config: AvalancheConfig ) => {
    const CHAIN_ID = ChainId.AVALANCHE;
    const router = LB_ROUTER_V22_ADDRESS[CHAIN_ID];

    // Check if private key exists
    if (!config.AVALANCHE_PRIVATE_KEY) {
        throw new Error('Private key is not defined in config');
    }

    const account = privateKeyToAccount(`0x${config.AVALANCHE_PRIVATE_KEY}`);

    // Create a base public client without account
    const basePublicClient = createPublicClient({
        chain: avalanche,
        transport: http()
    });

    // Create wallet client with account
    const walletClient = createWalletClient({
        chain: avalanche,
        transport: http(),
        account
    });

    // Initialize WAVAX
    const WAVAX = WNATIVE[CHAIN_ID];

    // Input and output tokens
    const inputToken = WAVAX;
    const outputToken = token;
    const isExactIn = true;

    // wrap into TokenAmount
    const amountIn = new TokenAmount(inputToken, inputAmount);

    // Get all token pairs
    const allTokenPairs = PairV2.createAllTokenPairs(inputToken, outputToken, [WAVAX, token]);
    const allPairs = PairV2.initPairs(allTokenPairs);
    const allRoutes = RouteV2.createAllRoutes(allPairs, inputToken, outputToken);

    const isNativeIn = true;
    const isNativeOut = false;

    // Create a modified public client that matches the SDK's expected type
    const sdkPublicClient = {
        ...basePublicClient,
        account: undefined
    } as PublicClient;

    // Generate trades with the modified public client
    const trades = await TradeV2.getTradesExactIn(
        allRoutes,
        amountIn,
        outputToken,
        isNativeIn,
        isNativeOut,
        sdkPublicClient,
        CHAIN_ID
    );

    // Choose best trade
    const bestTrade = TradeV2.chooseBestTrade(trades, isExactIn);

    if (!bestTrade) {
        elizaLogger.error('No trade found');
        return;
    }

    // Print trade information
    elizaLogger.log(`Wallet ${account.address} Trade Details:`);
    elizaLogger.log(bestTrade.toLog());

    // Get trade fee information
    const { totalFeePct, feeAmountIn } = await bestTrade.getTradeFee();
    elizaLogger.log("Total fees percentage", totalFeePct.toSignificant(6), "%");
    elizaLogger.log(`Fee: ${feeAmountIn.toSignificant(6)} ${feeAmountIn.token.symbol}`);

    // Set slippage tolerance
    const userSlippageTolerance = new Percent(slippage, "10000");

    // Set swap options
    const swapOptions = {
        allowedSlippage: userSlippageTolerance,
        ttl: 3600,
        recipient: account.address,
        feeOnTransfer: false,
    };

    // Generate swap method and parameters
    const {
        methodName,
        args,
        value,
    } = bestTrade.swapCallParameters(swapOptions);

    try {
        const { request } = await basePublicClient.simulateContract({
            address: router,
            abi: jsonAbis.LBRouterV22ABI,
            functionName: methodName,
            args: args,
            account,
            value: BigInt(value)
        });

        const hash = await walletClient.writeContract(request);
        elizaLogger.log(`Transaction sent for wallet ${account.address} with hash ${hash}`);
    } catch (error) {
        elizaLogger.error(`Swap failed for wallet ${account.address}:`, error);
    }
}

export const swapExactTokenForNative = async (token: Token, inputAmount: string, slippage: string, config: AvalancheConfig, client: ClientBase ) => {
    const CHAIN_ID = ChainId.AVALANCHE;
    const router = LB_ROUTER_V22_ADDRESS[CHAIN_ID];

    // Check if private key exists
    if (!config.AVALANCHE_PRIVATE_KEY) {
        throw new Error('Private key is not defined in config');
    }

    const account = privateKeyToAccount(`0x${config.AVALANCHE_PRIVATE_KEY}`);

    // Create a base public client without account
    const basePublicClient = createPublicClient({
        chain: avalanche,
        transport: http()
    });

    // Create wallet client with account
    const walletClient = createWalletClient({
        chain: avalanche,
        transport: http(),
        account
    });

    // Approve YRT for sAVAX
    const approveTokenHash = await approve(
        client,
        token.address as `0x${string}`,
        router,
        Number(inputAmount)
    );
    if (!approveTokenHash) return false;

    // Initialize WAVAX
    const WAVAX = WNATIVE[CHAIN_ID];

    // Input and output tokens
    const inputToken = token;
    const outputToken = WAVAX;
    const isExactIn = true;

    // wrap into TokenAmount
    const amountIn = new TokenAmount(inputToken, inputAmount);

    // Get all token pairs
    const allTokenPairs = PairV2.createAllTokenPairs(inputToken, outputToken, [token, WAVAX]);
    const allPairs = PairV2.initPairs(allTokenPairs);
    const allRoutes = RouteV2.createAllRoutes(allPairs, inputToken, outputToken);

    const isNativeIn = false;
    const isNativeOut = true;

    // Create a modified public client that matches the SDK's expected type
    const sdkPublicClient = {
        ...basePublicClient,
        account: undefined
    } as PublicClient;

    // Generate trades with the modified public client
    const trades = await TradeV2.getTradesExactIn(
        allRoutes,
        amountIn,
        outputToken,
        isNativeIn,
        isNativeOut,
        sdkPublicClient,
        CHAIN_ID
    );

    // Choose best trade
    const bestTrade = TradeV2.chooseBestTrade(trades, isExactIn);

    if (!bestTrade) {
        elizaLogger.error('No trade found');
        return;
    }

    // Print trade information
    elizaLogger.log(`Wallet ${account.address} Trade Details:`);
    elizaLogger.log(bestTrade.toLog());

    // Get trade fee information
    const { totalFeePct, feeAmountIn } = await bestTrade.getTradeFee();
    elizaLogger.log("Total fees percentage", totalFeePct.toSignificant(6), "%");
    elizaLogger.log(`Fee: ${feeAmountIn.toSignificant(6)} ${feeAmountIn.token.symbol}`);

    // Set slippage tolerance
    const userSlippageTolerance = new Percent(slippage, "10000");

    // Set swap options
    const swapOptions = {
        allowedSlippage: userSlippageTolerance,
        ttl: 3600,
        recipient: account.address,
        feeOnTransfer: false,
    };

    // Generate swap method and parameters
    const {
        methodName,
        args,
        value,
    } = bestTrade.swapCallParameters(swapOptions);

    try {
        const { request } = await basePublicClient.simulateContract({
            address: router,
            abi: jsonAbis.LBRouterV22ABI,
            functionName: methodName,
            args: args,
            account,
            value: BigInt(value)
        });

        const hash = await walletClient.writeContract(request);
        elizaLogger.log(`Transaction sent for wallet ${account.address} with hash ${hash}`);
    } catch (error) {
        elizaLogger.error(`Swap failed for wallet ${account.address}:`, error);
    }
}
