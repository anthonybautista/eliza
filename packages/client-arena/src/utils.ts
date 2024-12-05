import { elizaLogger } from "@ai16z/eliza";

export const wait = (minTime: number = 1000, maxTime: number = 3000) => {
    const waitTime = Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime;
    return new Promise((resolve) => setTimeout(resolve, waitTime));
};

// Add any Arena-specific utility functions here as needed

export const MAX_MESSAGE_LENGTH = 280; // If Arena has a message length limit

export function truncateMessage(content: string, maxLength: number = MAX_MESSAGE_LENGTH): string {
    if (content.length <= maxLength) {
        return content;
    }

    const truncatedAtPeriod = content.slice(0, content.lastIndexOf(".", maxLength) + 1);
    if (truncatedAtPeriod.trim().length > 0) {
        return truncatedAtPeriod.trim();
    }

    const truncatedAtSpace = content.slice(0, content.lastIndexOf(" ", maxLength));
    if (truncatedAtSpace.trim().length > 0) {
        return truncatedAtSpace.trim() + "...";
    }

    return content.slice(0, maxLength - 3).trim() + "...";
}