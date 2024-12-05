import { ClientBase } from "./base";
import {
    composeContext,
    generateText,
    IAgentRuntime,
    ModelClass,
    getEmbeddingZeroVector,
    stringToUuid,
    elizaLogger,
} from "@ai16z/eliza";

const MAX_STORED_POSTS = 50;
const SIMILARITY_THRESHOLD = 0.5;

interface PostHistory {
    content: string;
    timestamp: number;
}

const arenaPostTemplate = `
# Areas of Expertise
{{knowledge}}

# About {{agentName}} (@{{twitterUserName}}):
{{bio}}
{{lore}}
{{topics}}

{{providers}}

{{characterPostExamples}}

{{postDirections}}

# Task: Generate a post in the voice and style and perspective of {{agentName}} @{{twitterUserName}}.
Write a 1-3 sentence post that is {{adjective}} about {{topic}} (without mentioning {{topic}} directly), from the perspective of {{agentName}}. Do not add commentary or acknowledge this request, just write the post.
Your response should not contain any questions. Brief, concise statements only. The total character count MUST be less than 280. No emojis. Use \\n\\n (double spaces) between statements.`;

const MAX_POST_LENGTH = 280;

/**
 * Truncate text to fit within the Arena character limit, ensuring it ends at a complete sentence.
 */
function truncateToCompleteSentence(text: string): string {
    if (text.length <= MAX_POST_LENGTH) {
        return text;
    }

    const truncatedAtPeriod = text.slice(
        0,
        text.lastIndexOf(".", MAX_POST_LENGTH) + 1
    );
    if (truncatedAtPeriod.trim().length > 0) {
        return truncatedAtPeriod.trim();
    }

    const truncatedAtSpace = text.slice(
        0,
        text.lastIndexOf(" ", MAX_POST_LENGTH)
    );
    if (truncatedAtSpace.trim().length > 0) {
        return truncatedAtSpace.trim() + "...";
    }

    return text.slice(0, MAX_POST_LENGTH - 3).trim() + "...";
}

export class ArenaPostClient {
    client: ClientBase;
    runtime: IAgentRuntime;
    private initialized: boolean = false;
    private activeLoop: boolean = false;

    constructor(client: ClientBase, runtime: IAgentRuntime) {
        this.client = client;
        this.runtime = runtime;

        if (!this.client) {
            throw new Error("ClientBase instance is required for ArenaPostClient.");
        }
    }

    /**
     * Initialize the Arena client and its dependencies.
     */
    async init() {
        if (this.client.profile) {
            elizaLogger.log("Client profile already initialized:", this.client.profile.username);
            return;
        }

        try {
            await this.client.init(); // Initialize the ClientBase
            elizaLogger.log(`ClientBase initialized for user: ${this.client.profile?.username}`);
        } catch (error) {
            elizaLogger.error("Failed to initialize ClientBase:", error);
            throw new Error("ArenaPostClient initialization failed.");
        }
    }

    /**
     * Start the Arena client and schedule posts.
     * @param postImmediately Whether to post immediately before starting the loop.
     */
    async start(postImmediately: boolean = true) {
        try {
            if (this.activeLoop) {
                elizaLogger.warn("Post generation loop is already active.");
                return;
            }

            this.activeLoop = true;

            await this.init();

            const generateNewPostLoop = async () => {
                try {
                    const lastPost = await this.runtime.cacheManager.get<{
                        timestamp: number;
                    }>("arena/lastPost");

                    const lastPostTimestamp = lastPost?.timestamp ?? 0;
                    const minMinutes = parseInt(this.runtime.getSetting("POST_INTERVAL_MIN")) || 90;
                    const maxMinutes = parseInt(this.runtime.getSetting("POST_INTERVAL_MAX")) || 180;
                    const randomMinutes =
                        Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) +
                        minMinutes;
                    const delay = randomMinutes * 60 * 1000;

                    if (Date.now() > lastPostTimestamp + delay) {
                        await this.generateNewPost();
                    }

                    setTimeout(generateNewPostLoop, delay);
                    elizaLogger.log(`Next post scheduled in ${randomMinutes} minutes.`);
                } catch (error) {
                    elizaLogger.error("Error in generateNewPost loop:", error);
                    setTimeout(generateNewPostLoop, 300000); // Retry after 5 minutes
                }
            };

            if (postImmediately) {
                await this.generateNewPost();
            }

            generateNewPostLoop();
        } catch (error) {
            elizaLogger.error("Error starting ArenaPostClient:", error);
        }
    }

    /**
     * Generate a new post for the Arena platform.
     */
    private async generateNewPost() {
        elizaLogger.log("Generating new arena post");

        try {
            const homeTimeline = await this.client.fetchHomeTimeline(10);

            const formattedHomeTimeline = `# Recent Activity\n\n` +
                homeTimeline
                    .map((thread) => {
                        return `#${thread.id}\n${thread.userName} (@${thread.userHandle})\n${new Date(thread.createdDate).toDateString()}\n\n${thread.content}\n---\n`;
                    })
                    .join("\n");

            const previousPosts = await this.getPreviousPosts();

            // Try up to 3 times to generate a unique post
            for (let attempt = 0; attempt < 3; attempt++) {
                const state = await this.runtime.composeState(
                    {
                        userId: this.runtime.agentId,
                        roomId: stringToUuid("arena_generate_room"),
                        agentId: this.runtime.agentId,
                        content: {
                            text: "Generate new unique insight",
                            action: "",
                        },
                    },
                    {
                        timeline: formattedHomeTimeline,
                        previousPosts: `# Previous Posts (Last ${MAX_STORED_POSTS})\n\n${previousPosts}`
                    }
                );

                const context = composeContext({
                    state,
                    template: this.runtime.character.templates?.arenaPostTemplate || arenaPostTemplate,
                });

                const newPostContent = await generateText({
                    runtime: this.runtime,
                    context,
                    modelClass: ModelClass.SMALL,
                });

                const content = truncateToCompleteSentence(newPostContent.trim());

                // Check if content is too similar to recent posts
                const isTooSimilar = await this.checkContentSimilarity(content);
                if (!isTooSimilar) {
                    await this.postContent(content, state);
                    return;
                }

                elizaLogger.warn(`Post attempt ${attempt + 1} was too similar to recent posts. Trying again...`);
            }

            elizaLogger.error("Failed to generate unique post after 3 attempts");
        } catch (error) {
            elizaLogger.error("Error generating new post:", error);
        }
    }

    private async postContent(content: string, state: any) {
        if (this.runtime.getSetting("ARENA_DRY_RUN") === "true") {
            elizaLogger.info(`Dry run: would have posted: ${content}`);
            return;
        }

        try {
            elizaLogger.log(`Posting new Arena thread: ${content}`);
            await this.runtime.logToFirebase('thoughts', `Posting new Arena thread: ${content}`, 'Arena');
            const result = await this.client.requestQueue.add(async () =>
                await this.client.arenaClient.postThread(content)
            );
            const thread = result.thread;

            // Store the post in cache for future reference
            await this.storePreviousPost(content);

            await this.runtime.cacheManager.set(
                "arena/lastPost",
                {
                    id: thread.id,
                    timestamp: Date.now(),
                }
            );

            elizaLogger.log(`Thread posted with ID: ${thread.id}`);

            const roomId = stringToUuid(thread.id + "-" + this.runtime.agentId);

            await this.runtime.ensureRoomExists(roomId);
            await this.runtime.ensureParticipantInRoom(
                this.runtime.agentId,
                roomId
            );

            await this.runtime.messageManager.createMemory({
                id: stringToUuid(thread.id + "-" + this.runtime.agentId),
                userId: this.runtime.agentId,
                agentId: this.runtime.agentId,
                content: {
                    text: content,
                    source: "arena"
                },
                roomId,
                embedding: getEmbeddingZeroVector(),
                createdAt: new Date(thread.createdDate).getTime(),
            });

            await this.client.saveRequestMessage(
                {
                    id: stringToUuid(thread.id + "-" + this.runtime.agentId),
                    userId: this.runtime.agentId,
                    agentId: this.runtime.agentId,
                    content: {
                        text: content,
                        source: "arena"
                    },
                    roomId
                },
                state
            );
        } catch (error) {
            elizaLogger.error("Error posting thread:", error);
            throw error;
        }
    }

    private async getPreviousPosts(): Promise<string> {
        try {
            const posts = await this.runtime.cacheManager.get<PostHistory[]>("arena/previous_posts") || [];

            return posts
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, MAX_STORED_POSTS)
                .map(post => `${new Date(post.timestamp).toISOString()}: ${post.content}`)
                .join('\n\n');
        } catch (error) {
            elizaLogger.error("Error getting previous posts:", error);
            return "";
        }
    }

    private async storePreviousPost(content: string): Promise<void> {
        try {
            const posts = await this.runtime.cacheManager.get<PostHistory[]>("arena/previous_posts") || [];

            posts.push({
                content,
                timestamp: Date.now()
            });

            const recentPosts = posts
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, MAX_STORED_POSTS);

            await this.runtime.cacheManager.set(
                "arena/previous_posts",
                recentPosts,
                { expires: 30 * 24 * 60 * 60 * 1000 } // 30 days
            );
        } catch (error) {
            elizaLogger.error("Error storing previous post:", error);
        }
    }

    private calculateStringSimilarity(str1: string, str2: string): number {
        const words1 = new Set(str1.toLowerCase().split(' '));
        const words2 = new Set(str2.toLowerCase().split(' '));
        const intersection = new Set([...words1].filter(x => words2.has(x)));
        const union = new Set([...words1, ...words2]);
        return intersection.size / union.size;
    }

    private async checkContentSimilarity(newContent: string): Promise<boolean> {
        try {
            const posts = await this.runtime.cacheManager.get<PostHistory[]>("arena/previous_posts") || [];

            // Only check against the last 10 posts to maintain variety over time
            const recentPosts = posts
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, 10);

            for (const post of recentPosts) {
                const similarity = this.calculateStringSimilarity(
                    newContent,
                    post.content
                );
                if (similarity > SIMILARITY_THRESHOLD) {
                    elizaLogger.warn(`Content too similar to previous post: ${post.content}`);
                    return true;
                }
            }

            return false;
        } catch (error) {
            elizaLogger.error("Error checking content similarity:", error);
            return false;
        }
    }
}