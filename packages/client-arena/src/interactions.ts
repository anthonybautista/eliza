import { ClientBase } from "./base";
import { Notification, ThreadFeedItem } from "./arena";
import {
    composeContext,
    generateMessageResponse,
    generateShouldRespond,
    messageCompletionFooter,
    shouldRespondFooter,
    Content,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelClass,
    State,
    stringToUuid,
    elizaLogger,
    getEmbeddingZeroVector
} from "@ai16z/eliza";

// Enhanced templates for better responses
const arenaMessageHandlerTemplate = `# Task: Generate a focused response as {{agentName}}.
About {{agentName}}:
{{bio}}
{{lore}}

# Current Thread Context
Original Post:
{{formattedConversation}}

# Broader Timeline Context for Awareness
{{timeline}}

Current Message to Respond To:
{{currentPost}}

CRITICAL INSTRUCTIONS:
- Keep responses relevant to the thread topic
- Match the tone and style of the platform
- Be engaging but concise (2-3 sentences max)
- Stay focused on the immediate discussion
- Add value to the conversation
- Use natural, conversational language
- Don't be overly formal or stiff
- Don't repeat what others have said

# Examples of {{agentName}}'s style and voice:
{{characterMessageExamples}}

# Instructions: Write a single, natural response that adds value to the discussion while maintaining {{agentName}}'s voice.${messageCompletionFooter}`;

const arenaShouldRespondTemplate = `# About {{agentName}}:
{{bio}}

# RESPONSE RULES
1. Respond if:
   - The message directly engages with your previous comment
   - You have relevant expertise or insight to share
   - The topic aligns with your interests and knowledge
   - You can meaningfully advance the discussion

2. Do NOT respond if:
   - The conversation has naturally concluded
   - Others have already made your intended points
   - You would just be agreeing or acknowledging
   - The topic is outside your expertise
   - The message is hostile or trolling

Thread Context:
{{formattedConversation}}

Current Message:
{{currentPost}}

Timeline Context:
{{timeline}}

IMPORTANT: Choose [RESPOND] only if you can make a valuable contribution. Default to [IGNORE] if unsure. Use [STOP] if the conversation is complete or you're asked to disengage.${shouldRespondFooter}`;

export class ArenaInteractionClient {
    private client: ClientBase;
    private runtime: IAgentRuntime;
    private processedNotifications: Set<string>;

    constructor(client: ClientBase, runtime: IAgentRuntime) {
        this.client = client;
        this.runtime = runtime;
        this.processedNotifications = new Set();
        this.loadProcessedNotifications();
    }

    private async loadProcessedNotifications() {
        const saved = await this.runtime.cacheManager.get<string[]>('arena/processed_notifications');
        if (saved) {
            saved.forEach(id => this.processedNotifications.add(id));
        }
    }

    private async saveProcessedNotifications() {
        await this.runtime.cacheManager.set(
            'arena/processed_notifications',
            Array.from(this.processedNotifications)
        );
    }

    async start() {
        const handleInteractionsLoop = () => {
            this.handleArenaInteractions();
            const randomMinutes = Math.floor(Math.random() * (5 - 2 + 1)) + 2;
            setTimeout(handleInteractionsLoop, randomMinutes * 60 * 1000);
        };

        handleInteractionsLoop();
    }

    private parseThreadIdFromLink(link: string): string | null {
        const parts = link.split('/');
        const segments = parts.filter(part => part.length > 0);

        if (segments.length >= 3) {
            if (segments[1] === 'nested' || segments[1] === 'status') {
                return segments[2];
            }
        }

        return null;
    }

    private async handleArenaInteractions() {
        elizaLogger.log("Checking Arena notifications");

        try {
            const notifications = await this.client.requestQueue.add(() =>
                this.client.arenaClient.getAllNotifications(3)
            );

            elizaLogger.log(`Received ${notifications.length} notifications`);

            const replyNotifications = notifications.filter(notification =>
                notification.title.toLowerCase().includes("replied") &&
                !this.processedNotifications.has(notification.id)
            );

            elizaLogger.log(`Found ${replyNotifications.length} unprocessed reply notifications`);

            for (const notification of replyNotifications) {
                elizaLogger.log("Processing notification:", notification.id);

                const roomId = stringToUuid(notification.id + "-" + this.runtime.agentId);
                const userIdUUID = stringToUuid(notification.userId);
                const username = notification.title.split(" ")[0];

                await this.runtime.ensureConnection(
                    userIdUUID,
                    roomId,
                    username,
                    username,
                    "arena"
                );

                const message: Memory = {
                    content: {
                        text: notification.text || notification.title,
                        source: "arena",
                        url: notification.link
                    },
                    agentId: this.runtime.agentId,
                    userId: userIdUUID,
                    roomId
                };

                const threadId = this.parseThreadIdFromLink(notification.link);
                if (threadId) {
                    elizaLogger.log(`Processing thread ID: ${threadId}`);
                    await this.handleNotification({
                        notification,
                        message,
                        threadId
                    });
                } else {
                    elizaLogger.warn(`Could not parse thread ID from link: ${notification.link}`);
                }
            }

            elizaLogger.log("Finished checking Arena notifications");
        } catch (error) {
            elizaLogger.error("Error handling Arena interactions:", error);
        }
    }

    private async handleNotification({
        notification,
        message,
        threadId
    }: {
        notification: Notification;
        message: Memory;
        threadId: string;
    }) {
        if (!message.content.text) {
            elizaLogger.log("Skipping notification with no text", notification.id);
            return { text: "", action: "IGNORE" };
        }

        elizaLogger.log("Processing notification: ", notification.id);

        try {
            const threadContext = await this.getThreadContext(threadId);
            const timelineContext = await this.getTimelineContext();

            let state: State = await this.runtime.composeState(message, {
                timeline: timelineContext,
                formattedConversation: threadContext,
                currentPost: this.formatNotification(notification)
            });

            const notificationId = stringToUuid(notification.id + "-" + this.runtime.agentId);
            const exists = await this.runtime.messageManager.getMemoryById(notificationId);

            if (!exists) {
                const memoryMessage: Memory = {
                    id: notificationId,
                    agentId: this.runtime.agentId,
                    content: {
                        text: notification.text || notification.title,
                        url: notification.link,
                        source: "arena"
                    },
                    userId: stringToUuid(notification.userId),
                    roomId: message.roomId,
                    createdAt: new Date(notification.createdOn).getTime(),
                    embedding: getEmbeddingZeroVector()
                };
                await this.client.saveRequestMessage(memoryMessage, state);
            }

            const shouldRespondContext = composeContext({
                state,
                template: this.runtime.character.templates?.arenaShouldRespondTemplate ||
                         arenaShouldRespondTemplate
            });

            const shouldRespond = await generateShouldRespond({
                runtime: this.runtime,
                context: shouldRespondContext,
                modelClass: ModelClass.MEDIUM
            });

            if (shouldRespond !== "RESPOND") {
                elizaLogger.log("Not responding to notification");
                this.processedNotifications.add(notification.id);
                await this.saveProcessedNotifications();
                return { text: "", action: shouldRespond };
            }

            const context = composeContext({
                state,
                template: this.runtime.character.templates?.arenaMessageHandlerTemplate ||
                         arenaMessageHandlerTemplate
            });

            const response = await generateMessageResponse({
                runtime: this.runtime,
                context,
                modelClass: ModelClass.MEDIUM
            });

            if (response.text) {
                try {
                    const callback: HandlerCallback = async (response: Content) => {
                        const reply = await this.client.requestQueue.add(() =>
                            this.client.arenaClient.replyToThread(threadId, response.text)
                        );

                        const memory: Memory = {
                            id: stringToUuid(reply.thread.id + "-" + this.runtime.agentId),
                            userId: this.runtime.agentId,
                            agentId: this.runtime.agentId,
                            content: {
                                text: response.text,
                                source: "arena",
                                url: reply.thread.id,
                                action: response.action
                            },
                            roomId: message.roomId,
                            embedding: getEmbeddingZeroVector(),
                            createdAt: new Date(reply.thread.createdDate).getTime()
                        };
                        return [memory];
                    };

                    const responseMessages = await callback(response);

                    state = await this.runtime.updateRecentMessageState(state);

                    for (const responseMessage of responseMessages) {
                        await this.client.saveRequestMessage(responseMessage, state);
                    }

                    await this.runtime.evaluate(message, state);
                    await this.runtime.processActions(message, responseMessages, state, callback);

                    this.processedNotifications.add(notification.id);
                    await this.saveProcessedNotifications();

                    const responseInfo = `Context:\n\n${context}\n\nNotification: ${notification.id}\nAgent's Output:\n${response.text}`;
                    elizaLogger.log(`Responded to Arena Notification: ${response.text}`);
                    await this.runtime.logToFirebase('thoughts', `Responded to Arena Notification: ${response.text}`, 'Arena');
                    await this.runtime.cacheManager.set(
                        `arena/response_${notification.id}.txt`,
                        responseInfo
                    );

                } catch (error) {
                    elizaLogger.error(`Error sending response:`, error);
                }
            }
        } catch (error) {
            elizaLogger.error(`Error handling notification ${notification.id}:`, error);
        }
    }

    private async getTimelineContext(): Promise<string> {
        try {
            const response = await this.client.requestQueue.add(() =>
                this.client.arenaClient.getThreadFeed(1, 10)
            );

            if (!response || !response.threads) {
                elizaLogger.warn("No timeline data received");
                return "";
            }

            return response.threads
                .map((thread: ThreadFeedItem) =>
                    `ID: ${thread.id}
                    From: ${thread.userName} (@${thread.userHandle})
                    Content: ${thread.content}
                    Created: ${new Date(thread.createdDate).toLocaleString()}
                    Stats: ${thread.likeCount} likes, ${thread.answerCount} replies
                    ---`)
                .join("\n\n");
        } catch (error) {
            elizaLogger.error("Error getting timeline context:", error);
            return "";
        }
    }

    private async getThreadContext(threadId: string): Promise<string> {
        try {
            elizaLogger.log(`Fetching thread context for ID: ${threadId}`);
            const response = await this.client.requestQueue.add(() =>
                this.client.arenaClient.getThreadFeed(1, 5, threadId)
            );

            if (!response || !response.threads || response.threads.length === 0) {
                elizaLogger.warn(`No thread data found for ID: ${threadId}`);
                return "";
            }

            return response.threads
                .map(this.formatThreadForContext)
                .join("\n\n");
        } catch (error) {
            elizaLogger.error(`Error getting thread context for ${threadId}:`, error);
            return "";
        }
    }

    private formatThreadForContext(thread: ThreadFeedItem): string {
        return `Thread by ${thread.userName} (@${thread.userHandle}):
                Content: ${thread.content}
                Created: ${new Date(thread.createdDate).toLocaleString()}
                Replies: ${thread.answerCount}
                Language: ${thread.language}
                Type: ${thread.threadType}`;
    }

    private formatNotification(notification: Notification): string {
        return `Notification: ${notification.title}
                Content: ${notification.text || "No content"}
                Created: ${new Date(notification.createdOn).toLocaleString()}
                Link: ${notification.link}`;
    }
}