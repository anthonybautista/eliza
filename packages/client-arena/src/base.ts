import {
    Content,
    IAgentRuntime,
    Memory,
    State,
    elizaLogger,
    stringToUuid,
    getEmbeddingZeroVector
} from "@ai16z/eliza";
import { EventEmitter } from "events";
import { ArenaApiClient, Thread } from "./arena";

type ArenaProfile = {
    id: string;
    username: string;
    screenName: string;
    bio: string;
    nicknames: string[];
};

class RequestQueue {
    private queue: (() => Promise<any>)[] = [];
    private processing: boolean = false;

    async add<T>(request: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
                try {
                    const result = await request();
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            });
            this.processQueue();
        });
    }

    private async processQueue(): Promise<void> {
        if (this.processing || this.queue.length === 0) {
            return;
        }
        this.processing = true;

        while (this.queue.length > 0) {
            const request = this.queue.shift()!;
            try {
                await request();
            } catch (error) {
                console.error("Error processing request:", error);
                this.queue.unshift(request);
                await this.exponentialBackoff(this.queue.length);
            }
            await this.randomDelay();
        }

        this.processing = false;
    }

    private async exponentialBackoff(retryCount: number): Promise<void> {
        const delay = Math.pow(2, retryCount) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
    }

    private async randomDelay(): Promise<void> {
        const delay = Math.floor(Math.random() * 2000) + 1500;
        await new Promise((resolve) => setTimeout(resolve, delay));
    }
}

export class ClientBase extends EventEmitter {
    runtime: IAgentRuntime;
    arenaClient: ArenaApiClient;
    directions: string;
    profile: ArenaProfile | null;
    requestQueue: RequestQueue = new RequestQueue();
    lastCheckedTime: number = Date.now();

    constructor(runtime: IAgentRuntime) {
        super();
        this.runtime = runtime;
        this.arenaClient = new ArenaApiClient(runtime);
        this.directions = "- " + this.runtime.character.style.all.join("\n- ") +
                         "- " + this.runtime.character.style.post.join();
    }

    async init() {
        if (!this.runtime.getSetting("ARENA_BEARER_TOKEN")) {
            throw new Error("Arena bearer token not configured");
        }

        // Initialize profile
        this.profile = await this.fetchProfile();
        if (this.profile) {
            elizaLogger.log("Arena user profile loaded:", JSON.stringify(this.profile, null, 2));
        } else {
            throw new Error("Failed to load profile");
        }

        // Populate timeline
        await this.populateTimeline();
    }

    async fetchHomeTimeline(count: number = 20) {
        elizaLogger.debug("Fetching home timeline");
        const response = await this.arenaClient.getThreadFeed(1, count);
        return response.threads;
    }

    private async populateTimeline() {
        elizaLogger.debug("Populating timeline...");

        const cachedTimeline = await this.getCachedTimeline();

        if (cachedTimeline) {
            const existingMemories = await this.runtime.messageManager.getMemoriesByRoomIds({
                roomIds: cachedTimeline.map(thread =>
                    stringToUuid(thread.id + "-" + this.runtime.agentId)
                ),
            });

            const existingMemoryIds = new Set(existingMemories.map(memory => memory.id.toString()));

            const someCachedThreadsExist = cachedTimeline.some(thread =>
                existingMemoryIds.has(stringToUuid(thread.id + "-" + this.runtime.agentId))
            );

            if (someCachedThreadsExist) {
                const threadsToSave = cachedTimeline.filter(thread =>
                    !existingMemoryIds.has(stringToUuid(thread.id + "-" + this.runtime.agentId))
                );

                for (const thread of threadsToSave) {
                    await this.saveThreadAsMemory(thread);
                }

                elizaLogger.log(`Populated ${threadsToSave.length} missing threads from cache.`);
                return;
            }
        }

        const timeline = await this.fetchHomeTimeline(50);
        for (const thread of timeline) {
            await this.saveThreadAsMemory(thread);
        }

        await this.cacheTimeline(timeline);
    }

    private async saveThreadAsMemory(thread: any) {
        const roomId = stringToUuid(thread.id + "-" + this.runtime.agentId);
        const userId = stringToUuid(thread.userId);

        await this.runtime.ensureConnection(
            userId,
            roomId,
            thread.userHandle,
            thread.userName,
            "arena"
        );

        const memory: Memory = {
            id: stringToUuid(thread.id + "-" + this.runtime.agentId),
            userId,
            content: {
                text: thread.content,
                source: "arena",
                url: `/thread/${thread.id}`
            },
            agentId: this.runtime.agentId,
            roomId,
            embedding: getEmbeddingZeroVector(),
            createdAt: new Date(thread.createdDate).getTime()
        };

        await this.runtime.messageManager.createMemory(memory);
    }

    async saveRequestMessage(message: Memory, state: State) {
        if (message.content.text) {
            const recentMessage = await this.runtime.messageManager.getMemories({
                roomId: message.roomId,
                count: 1,
                unique: false
            });

            if (recentMessage.length > 0 && recentMessage[0].content === message.content) {
                elizaLogger.debug("Message already saved", recentMessage[0].id);
            } else {
                await this.runtime.messageManager.createMemory({
                    ...message,
                    embedding: getEmbeddingZeroVector()
                });
            }

            await this.runtime.evaluate(message, state);
        }
    }

    private async getCachedTimeline(): Promise<Thread[] | undefined> {
        return await this.runtime.cacheManager.get<Thread[]>('arena/timeline');
    }

    private async cacheTimeline(timeline: any[]) {
        await this.runtime.cacheManager.set('arena/timeline', timeline,
            { expires: 10 * 1000 }
        );
    }

    private async getCachedProfile() {
        return await this.runtime.cacheManager.get<ArenaProfile>('arena/profile');
    }

    private async cacheProfile(profile: ArenaProfile) {
        await this.runtime.cacheManager.set('arena/profile', profile);
    }

    private async fetchProfile(): Promise<ArenaProfile> {
        const cached = await this.getCachedProfile();
        if (cached) return cached;

        try {
            // In Arena's case, we might need to get this from the user's threads or settings
            // This is a placeholder implementation
            const profile: ArenaProfile = {
                id: this.runtime.agentId,
                username: this.runtime.character.name,
                screenName: this.runtime.character.name,
                bio: typeof this.runtime.character.bio === "string"
                    ? this.runtime.character.bio
                    : this.runtime.character.bio[0] || "",
                nicknames: []
            };

            await this.cacheProfile(profile);
            return profile;

        } catch (error) {
            elizaLogger.error("Error fetching Arena profile:", error);
            return undefined;
        }
    }
}