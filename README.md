# Eliza Avalanche Agent 🤖

A submission for Avalanche Bounty9000 #2: Create an Autonomous Agent That Interacts On-chain

## Author
[xrpant](https://x.com/xrpant)

## Introduction
This project is a fork of the [Eliza Framework](https://github.com/ai16z/eliza) specifically enhanced for Avalanche C-Chain interactions. While the original Eliza framework provides a robust foundation for AI agents, this fork adds specialized capabilities for DeFi operations and social interactions on Avalanche.

**Note:** If you're looking for general agent development, please refer to the [original Eliza repository](https://github.com/ai16z/eliza). This fork is specifically for Avalanche-focused development.

## My AI Agent

### About

<div align="center">
  <img src="https://yorquant.ai/yorquant.png" alt="Yorquant - The Trading Hutt" width="400" />
</div>

Meet Yorquant, an autonomous agent built utilizing ChatGPT-4o-mini that integrates DeFi operations with social interactions. You can follow Yorquant's activities across multiple platforms:

- 🌐 [yorquant.ai](https://yorquant.ai) - Real-time dashboard of trades and interactions
- 🏟️ [arena.social/YorquantAI](https://arena.social/YorquantAI) - Arena social profile
- 🐦 [@YorquantAI](https://x.com/YorquantAI) - Twitter updates

The agent integrates:
- Advanced DeFi operations on Avalanche C-Chain
- Social engagement through The Arena platform
- Data-driven trading decisions with real-time market analysis
- Comprehensive activity logging via Firebase

### Goals
- Demonstrate sophisticated autonomous DeFi operations on Avalanche
- Showcase integration between on-chain and social activities
- Provide a framework for building complex trading strategies
- Create a self-documenting system through Firebase logging

### Capabilities
- Automated token swapping and liquidity provision
- Yield farming management with Yield Yak
- Arena social engagement and ticket purchasing
- Real-time activity logging and monitoring
- Custom trade logic evaluation
- Market trend analysis and decision making

## New Components

### 1. client-avalanche
A specialized client for Avalanche C-Chain interactions that provides advanced DeFi capabilities.

**Key Features:**
- Token swaps via Trader Joe SDK
- Yield Yak farm interactions
- Arena ticket purchasing
- Custom trade logic evaluation

**Configuration:**
```env
AVALANCHE_PRIVATE_KEY=your_private_key
TRADE_INTERVAL_MINUTES=180
HISTORY_INTERVAL=60
PAPER_TRADE=true
```

**Usage Example:**
```typescript
import { AvalancheClientInterface } from "@ai16z/client-avalanche";
import { setupTradeLogic } from './tradeLogic/yorquant';

// Initialize Avalanche client with custom trade logic
const avalancheClient = await AvalancheClientInterface.start(runtime);

// Set up trading parameters
const tradeConfig = {
  interval: process.env.TRADE_INTERVAL_MINUTES,
  paperTrading: process.env.PAPER_TRADE === 'true',
  minAvaxBalance: '1.0',
  maxShares: '100'
};

// Initialize trade logic
setupTradeLogic(tradeConfig);

// Example trade execution
const tradeAction = {
  type: 'BUY_SHARES',
  amount: BigInt(1),
  additionalInfo: 'Strategic purchase during low activity'
};

await executeTrade(client, tradeAction, sharesAccount, tradingAccount, config);
```

### 2. client-arena
Enables sophisticated social interactions within The Arena network.

**Key Features:**
- Notification monitoring and response
- Thread creation and management
- Chat message handling
- Context-aware responses

**Configuration:**
```env
AVALANCHE_PRIVATE_KEY=your_private_key
ARENA_BEARER_TOKEN=your_token
ARENA_DRY_RUN=false
ARENA_GROUP_ID=your_group_id
```

**Usage Example:**
```typescript
import { ArenaClientInterface } from "@ai16z/client-arena";

// Initialize Arena client
const arenaClient = new ArenaClientInterface({
  bearerToken: process.env.ARENA_BEARER_TOKEN,
  groupId: process.env.ARENA_GROUP_ID
});

// Example: Post a thread
const thread = await arenaClient.postThread(
  "Exploring the latest DeFi innovations on Avalanche"
);

// Example: Monitor and respond to notifications
arenaClient.on('notification', async (notification) => {
  if (notification.type === 'reply') {
    const context = await arenaClient.getThreadContext(notification.threadId);
    const response = await generateResponse(context);
    await arenaClient.replyToThread(notification.threadId, response);
  }
});
```

### 3. firebase-logger
A comprehensive logging solution using Firebase Realtime Database.

**Features:**
- Direct logging to Firebase
- Structured data storage
- Real-time monitoring capabilities

**Configuration:**
```env
FIREBASE_DATABASE_URL=your_database_url
FIREBASE_SERVICE_ACCOUNT=your_service_account_json
```

**Usage Example:**
```typescript
import { createFirebaseLogger } from '@ai16z/firebase-logger';

// Initialize logger
const firebaseLogger = createFirebaseLogger({
  serviceAccount: process.env.FIREBASE_SERVICE_ACCOUNT,
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

// Log trading activity
await runtime.logToFirebase('trades', {
  action: 'STAKE_YAK',
  amount: '10.5',
  token: 'AVAX',
  timestamp: Date.now()
}, 'transaction');
```

## Getting Started

1. Clone the repository:
```bash
git clone https://github.com/yourusername/eliza-avalanche
cd eliza-avalanche
```

2. Install dependencies:
```bash
pnpm install
```

3. Create environment file:
```bash
cp .env.example .env
```

4. Configure environment variables in `.env`:
```env
# Avalanche Configuration
AVALANCHE_PRIVATE_KEY=
TRADE_INTERVAL_MINUTES=180
HISTORY_INTERVAL=60
PAPER_TRADE=true

# Arena Configuration
ARENA_BEARER_TOKEN=
ARENA_DRY_RUN=false
ARENA_GROUP_ID=

# Firebase Configuration
FIREBASE_DATABASE_URL=
FIREBASE_SERVICE_ACCOUNT=
```

5. Build the project:
```bash
pnpm build
```

6. Start the agent:
```bash
pnpm start
```

## Trading Strategy

The agent implements a sophisticated trading strategy defined in `yorquant.ts` that includes:

1. Market Analysis:
   - Price trend monitoring
   - Supply change tracking
   - Volume analysis
   - Historical data evaluation

2. Decision Making:
   - Automated trade execution
   - Risk management
   - Position sizing
   - Timing optimization

3. Actions:
   - BUY_SHARES: Strategic share purchases
   - STAKE_YAK: Yield farming on idle AVAX
   - WITHDRAW_AND_BUY: Position reallocation

## On-chain Transactions

### Share Purchase History
The agent has executed several strategic share purchases on The Arena, demonstrating its autonomous trading capabilities:

- [Buy 0.113 AVAX worth of shares](https://snowtrace.io/tx/0xef2882c8fafc0c5dcaa0e2440de7dedbc27ee435cee46596c6379abc6ec2cbf1?chainid=43114) - Dec 01, 2024 21:06:36 UTC
- [Buy 3.105 AVAX worth of shares](https://snowtrace.io/tx/0xd3aac6a1bf1e71bf68441b90c6c817843518e5b742298e45c18e45c1bf8041d8?chainid=43114) - Dec 04, 2024 07:54:15 UTC
- [Buy 2.816 AVAX worth of shares](https://snowtrace.io/tx/0x674eb671dcc44555686cf5f900323fd23e82dcc21f9d7c64e6fcef15f270099a?chainid=43114) - Dec 04, 2024 22:02:37 UTC
- [Buy 2.677 AVAX worth of shares](https://snowtrace.io/tx/0xaad8fcebf8f0f69067aa460df7afef8f5e39291cbfb69ef01625da271f789149?chainid=43114) - Dec 05, 2024 04:03:20 UTC
- [Buy 2.816 AVAX worth of shares](https://snowtrace.io/tx/0x0c378a37dc4db9e601775277273598a23aed84b5359afb1457fb5fc31b344454?chainid=43114) - Dec 05, 2024 07:03:36 UTC
- [Buy 3.105 AVAX worth of shares](https://snowtrace.io/tx/0x2b2226f57d3b159ab1e00f529207437049c098de07279a0b73447acc4ed1508b?chainid=43114) - Dec 05, 2024 10:03:51 UTC
- [Buy 3.407 AVAX worth of shares](https://snowtrace.io/tx/0xa1542f5ef5c021f372d3f66143451bff4303ac255586f71e778c6d3fdc26e0fd?chainid=43114) - Dec 05, 2024 16:04:15 UTC
- [Buy 3.564 AVAX worth of shares](https://snowtrace.io/tx/0x5d43cc84c402e4612ba15f2a86c8b8f8d8fdeee726d2f1814c669ec4960540d3?chainid=43114) - Dec 05, 2024 21:19:13 UTC

The transactions show a pattern of regular purchases with varying amounts based on market conditions and the agent's trading strategy. The agent has demonstrated consistent activity over multiple days with successful execution of trades ranging from 0.113 to 3.564 AVAX.

## Contributing
Contributions are welcome! Please feel free to submit a Pull Request.

## License
MIT

## Acknowledgments
- [Eliza Framework](https://github.com/ai16z/eliza) for the core agent framework
- Avalanche Foundation for the bounty program
- The Arena for social integration capabilities
- Trader Joe team for the DEX SDK
- Yield Yak team for farming capabilities