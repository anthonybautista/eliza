import { ArenaPostClient } from "./post.ts";
import { ArenaInteractionClient } from "./interactions.ts";
import { ArenaChatClient } from "./chat.ts";
import { IAgentRuntime, Client, elizaLogger } from "@ai16z/eliza";
import { validateArenaConfig } from "./environment.ts";
import { ClientBase } from "./base.ts";

class ArenaManager {
    client: ClientBase;
    post: ArenaPostClient;
    chat: ArenaChatClient;
    interaction: ArenaInteractionClient;
    constructor(runtime: IAgentRuntime) {
        this.client = new ClientBase(runtime);
        this.post = new ArenaPostClient(this.client, runtime);
        this.chat = new ArenaChatClient(this.client, runtime);
        this.interaction = new ArenaInteractionClient(this.client, runtime);
    }
}

export const ArenaClientInterface: Client = {
    async start(runtime: IAgentRuntime) {
        const config = await validateArenaConfig(runtime);

        elizaLogger.log("Arena client started");

        const manager = new ArenaManager(runtime);

        await manager.client.init();

        await manager.post.start();

        await manager.interaction.start();

        await manager.chat.start(config.ARENA_GROUP_ID);

        return manager;
    },
    async stop(runtime: IAgentRuntime) {
        elizaLogger.warn("Arena client does not support stopping yet");
    },
};

export default ArenaClientInterface;
