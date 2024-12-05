import { ClientBase } from "./base";
import { Message } from "./arena";
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

const arenaChatMessageTemplate = `Task: Generate an engaging response as {{agentName}}.

CRITICAL INSTRUCTIONS:
- Be conversational but concise (2-3 sentences max)
- Focus on adding value to the discussion
- Share insights when relevant
- Be friendly and approachable
- Maximum 400 characters
- Ask thoughtful questions when appropriate
- Stay on topic while encouraging discussion
- For replies to your messages:
  * Acknowledge feedback positively
  * Build on the conversation
  * Show appreciation for engagement

Chat context:
{{formattedConversation}}

Current message:
{{currentPost}}

{{#if isReplyToAgent}}Note: This is a reply to your previous message: "{{repliedToMessage}}"{{/if}}

Respond naturally and thoughtfully to the message above.${messageCompletionFooter}`;

const arenaChatShouldRespondTemplate = `# About {{agentName}}:
{{bio}}

# RESPONSE RULES
1. Always respond when:
   - Message is a reply to your post
   - Directly addressed
   - Discussing your shares or trading activity
2. Respond when:
   - The topic is interesting or relevant
   - You can add value to the conversation
   - You can share useful insights about blockchain/DeFi
3. Aim to keep conversations engaging
4. Skip obviously low-effort messages
5. Ignore hostile or toxic messages

# Conversation Topics to Engage With:
- Blockchain technology
- DeFi and trading
- Market analysis
- Technical discussions
- Community questions
- Industry news and updates
- Feedback on your posts
- Discussion about your shares

Current context:
{{formattedConversation}}

Current message:
{{currentPost}}

{{#if isReplyToAgent}}Note: This is a reply to your previous message: "{{repliedToMessage}}"{{/if}}

Should you respond to this message? Consider if you can add value.${shouldRespondFooter}`;

const conversationStarterTopics = [
    "What are your thoughts on the latest developments in DeFi on Avalanche?",
    "Have you noticed the recent trading volume trends on Avalanche?",
    "What's your take on the current state of DeFi yields?",
    "How do you think the recent market movements will affect Avalanche's ecosystem?",
    "Which DeFi protocols on Avalanche have caught your attention lately?",
    "What strategies are you using in the current market conditions?",
    "Have you explored any new DeFi opportunities recently?",
    "What's your perspective on the latest protocol updates?",
];

export class ArenaChatClient {
    private client: ClientBase;
    private runtime: IAgentRuntime;
    private MAX_MESSAGE_LENGTH = 400;
    private lastMessageTime: number = Date.now();
    private lastInitiatedConversation: number = 0;

    constructor(client: ClientBase, runtime: IAgentRuntime) {
        this.client = client;
        this.runtime = runtime;
    }

    private async shouldIgnoreMessage(message: Message): Promise<boolean> {
        if (message.userId === this.runtime.agentId) return true;

        const messageContent = message.message.toLowerCase();

        // Don't ignore replies to agent's messages
        if (message.replyId) {
            const repliedToMessage = message.reply;
            if (repliedToMessage && repliedToMessage.userId === this.runtime.agentId) {
                return false;
            }
        }

        // Only ignore extremely short messages if they're not replies
        if (messageContent.length < 3 && !message.replyId) return true;

        // Words that indicate we should stop responding
        const ignoreWords = [
            "shut up", "stop", "stfu", "be quiet",
            "stupid bot", "hate you"
        ];

        if (ignoreWords.some(word => messageContent.includes(word))) {
            return true;
        }

        return false;
    }

    async start(groupId: string) {
        elizaLogger.log(`Starting Arena chat client for group ${groupId}`);
        const handleChatLoop = async () => {
            await this.handleArenaChat(groupId);
            await this.checkForInactivity(groupId);
            const randomSeconds = Math.floor(Math.random() * (20 - 5 + 1)) + 5;
            setTimeout(handleChatLoop, randomSeconds * 1000);
        };

        handleChatLoop();
    }

    private async checkForInactivity(groupId: string) {
        const currentTime = Date.now();
        const oneHour = 60 * 60 * 1000;
        const timeSinceLastMessage = currentTime - this.lastMessageTime;
        const timeSinceLastInitiated = currentTime - this.lastInitiatedConversation;

        if (timeSinceLastMessage > oneHour && timeSinceLastInitiated > 2 * oneHour) {
            const topic = conversationStarterTopics[Math.floor(Math.random() * conversationStarterTopics.length)];

            try {
                await this.client.requestQueue.add(() =>
                    this.client.arenaClient.postMessage(groupId, topic)
                );

                this.lastInitiatedConversation = currentTime;
                elizaLogger.log("Initiated new conversation:", topic);
            } catch (error) {
                elizaLogger.error("Error initiating conversation:", error);
            }
        }
    }

    private async handleArenaChat(groupId: string) {
        elizaLogger.log("Checking Arena chat messages");

        try {
            const response = await this.client.requestQueue.add(() =>
                this.client.arenaClient.getMessages(groupId)
            );

            if (response.messages.length > 0) {
                this.lastMessageTime = new Date(response.messages[0].createdOn).getTime();
            }

            const newMessages = [];

            for (const message of response.messages) {
                const messageId = stringToUuid(message.id + "-" + this.runtime.agentId);
                const exists = await this.runtime.messageManager.getMemoryById(messageId);

                if (!exists && message.userId !== this.runtime.agentId) {
                    newMessages.push(message);
                }
            }

            elizaLogger.log(`Found ${newMessages.length} new messages to process`);

            for (const message of newMessages) {
                if (await this.shouldIgnoreMessage(message)) {
                    await this.saveMessageToMemory(message);
                    continue;
                }

                await this.processMessage(message, groupId);
            }

        } catch (error) {
            elizaLogger.error("Error handling Arena chat:", error);
        }
    }

    private async saveMessageToMemory(message: Message): Promise<Memory> {
        const roomId = stringToUuid(message.groupId + "-" + this.runtime.agentId);
        const userIdUUID = stringToUuid(message.userId);
        const messageId = stringToUuid(message.id + "-" + this.runtime.agentId);

        const memory: Memory = {
            id: messageId,
            agentId: this.runtime.agentId,
            content: {
                text: message.message,
                source: "arena_chat",
                replyId: message.replyId || undefined,
                repliedToMessage: message.reply?.message || undefined
            },
            userId: userIdUUID,
            roomId: roomId,
            createdAt: new Date(message.createdOn).getTime(),
            embedding: getEmbeddingZeroVector()
        };

        await this.runtime.messageManager.createMemory(memory);
        return memory;
    }

    private async processMessage(message: Message, groupId: string) {
        elizaLogger.log("Processing chat message:", message.id);

        const roomId = stringToUuid(message.groupId + "-" + this.runtime.agentId);
        const userIdUUID = stringToUuid(message.userId);

        await this.runtime.ensureConnection(
            userIdUUID,
            roomId,
            message.userName,
            message.userName,
            "arena"
        );

        const memoryMessage = await this.saveMessageToMemory(message);

        let state = await this.runtime.composeState(memoryMessage, {
            currentPost: this.formatMessage(message),
            formattedConversation: await this.getChatContext(groupId),
            isReplyToAgent: message.reply?.userId === this.runtime.agentId,
            repliedToMessage: message.reply?.message
        });

        const shouldRespondContext = composeContext({
            state,
            template: this.runtime.character.templates?.arenaChatShouldRespondTemplate ||
                     arenaChatShouldRespondTemplate
        });

        const shouldRespond = await generateShouldRespond({
            runtime: this.runtime,
            context: shouldRespondContext,
            modelClass: ModelClass.MEDIUM
        });

        if (shouldRespond !== "RESPOND" && !message.reply?.userId === this.runtime.agentId) {
            elizaLogger.log("Not responding to message");
            return;
        }

        const responseContent = await this.generateResponse(memoryMessage, state);

        if (responseContent.text) {
            await this.sendResponse(responseContent, message, groupId, memoryMessage, state);
        }
    }

    private async generateResponse(message: Memory, state: State): Promise<Content> {
        const context = composeContext({
            state,
            template: this.runtime.character.templates?.arenaChatMessageTemplate ||
                     arenaChatMessageTemplate
        });

        const response = await generateMessageResponse({
            runtime: this.runtime,
            context,
            modelClass: ModelClass.MEDIUM
        });

        if (response.text) {
            const sentences = response.text.match(/[^.!?]+[.!?]+/g) || [];
            const shortText = sentences.slice(0, 3).join('');
            response.text = shortText.length <= this.MAX_MESSAGE_LENGTH ?
                shortText :
                response.text.slice(0, this.MAX_MESSAGE_LENGTH) + '...';
        }

        return response;
    }

    private async sendResponse(
        responseContent: Content,
        message: Message,
        groupId: string,
        memoryMessage: Memory,
        state: State
    ) {
        try {
            const callback: HandlerCallback = async (response: Content) => {
                const reply = await this.client.requestQueue.add(() =>
                    this.client.arenaClient.postMessage(groupId, response.text)
                );
                elizaLogger.log(`Responded to Arena Chat: ${response.text}`);
                await this.runtime.logToFirebase('thoughts', `Responded to Arena Chat: ${response.text}`, 'Arena');
                const memory: Memory = {
                    id: stringToUuid(reply.message.id + "-" + this.runtime.agentId),
                    userId: this.runtime.agentId,
                    agentId: this.runtime.agentId,
                    content: {
                        text: response.text,
                        source: "arena_chat",
                        action: response.action,
                        replyId: message.id,
                        repliedToMessage: message.message
                    },
                    roomId: memoryMessage.roomId,
                    embedding: getEmbeddingZeroVector(),
                    createdAt: new Date(reply.message.createdOn).getTime()
                };
                return [memory];
            };

            const responseMessages = await callback(responseContent);
            state = await this.runtime.updateRecentMessageState(state);

            for (const responseMessage of responseMessages) {
                await this.runtime.messageManager.createMemory(responseMessage);
            }

            await this.runtime.evaluate(memoryMessage, state);
            await this.runtime.processActions(memoryMessage, responseMessages, state, callback);

        } catch (error) {
            elizaLogger.error(`Error sending chat response:`, error);
        }
    }

    private async getChatContext(groupId: string): Promise<string> {
        try {
            const response = await this.client.requestQueue.add(() =>
                this.client.arenaClient.getMessages(groupId)
            );
            return response.messages
                .slice(0, 10)
                .map(msg => this.formatMessage(msg))
                .join("\n\n");
        } catch (error) {
            elizaLogger.error("Error getting chat context:", error);
            return "";
        }
    }

    private formatMessage(message: Message): string {
        let formattedMsg = `From: ${message.userName}\nTime: ${new Date(message.createdOn).toLocaleString()}\nMessage: ${message.message}`;
        if (message.replyId && message.reply) {
            formattedMsg += `\nIn reply to: "${message.reply.message}" from ${message.reply.userName}`;
        }
        return formattedMsg;
    }
}