import { IAgentRuntime, Client, elizaLogger } from "@ai16z/eliza";
import { AvalancheTradeClient } from "./trade.js";
import { ClientBase } from "./base.js";
import { validateConfig, AvalancheConfig } from "./environment.js";

class AvalancheManager {
    client: ClientBase;
    trade: AvalancheTradeClient;

    constructor(runtime: IAgentRuntime, config: AvalancheConfig) {
        this.client = new ClientBase(runtime);
        this.trade = new AvalancheTradeClient(this.client, runtime, config);
    }
}

export const AvalancheClientInterface: Client = {
    async start(runtime: IAgentRuntime) {
        const config = await validateConfig(runtime);

        elizaLogger.log("Avalanche trading client started");

        const manager = new AvalancheManager(runtime, config);

        await manager.client.init();
        await manager.trade.start();

        return manager;
    },

    async stop(runtime: IAgentRuntime) {
        elizaLogger.warn("Avalanche client stopping");
    },
};

export default AvalancheClientInterface;