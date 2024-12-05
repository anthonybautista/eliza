import { Token } from "@traderjoe-xyz/sdk-core";

// Assuming ChainId is imported or defined
const AVALANCHE_CHAIN_ID = 43114; // Avalanche C-Chain

export const TOKENS = {
   WAVAX: new Token(
       AVALANCHE_CHAIN_ID,
       "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
       18,
       "WAVAX"
   ),
   USDC: new Token(
       AVALANCHE_CHAIN_ID,
       "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
       6,
       "USDC"
   ),
   USDT: new Token(
       AVALANCHE_CHAIN_ID,
       "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7",
       6,
       "USDT"
   ),
   BTCB: new Token(
       AVALANCHE_CHAIN_ID,
       "0x152b9d0FdC40C096757F570A51E494bd4b943E50",
       8,
       "BTC.b"
   ),
   ARENA: new Token(
       AVALANCHE_CHAIN_ID,
       "0xC605C2cf66ee98eA925B1bb4FeA584b71C00cC4C",
       18,
       "ARENA"
   ),
   SAVAX: new Token(
       AVALANCHE_CHAIN_ID,
       "0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE",
       18,
       "sAVAX"
   ),
   YRT_BENQI_SAVAX: new Token(
       AVALANCHE_CHAIN_ID,
       "0xc8cEeA18c2E168C6e767422c8d144c55545D23e9",
       18,
       "YRT"
   ),
} as const;

// Type for the tokens map
export type TokensMap = typeof TOKENS;

// Type for token symbols
export type TokenSymbol = keyof TokensMap;