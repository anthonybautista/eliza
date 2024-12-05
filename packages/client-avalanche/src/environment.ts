import { IAgentRuntime } from "@ai16z/eliza";
import { z } from "zod";

export const avalancheEnvSchema = z.object({
    AVALANCHE_PRIVATE_KEY: z
        .string()
        .min(64, "Private key must be 64 characters")
        .max(66, "Private key cannot exceed 66 characters")
        .regex(/^(0x)?[0-9a-fA-F]{64}$/, "Invalid private key format"),
    MIN_AVAX_BALANCE: z
        .string()
        .transform((val) => Number(val))
        .pipe(z.number().min(0.2))
        .default("0.2"),
    TRADE_INTERVAL_MINUTES: z
        .string()
        .transform((val) => Number(val))
        .pipe(z.number().min(1).max(360))
        .default("60"),
    HISTORY_INTERVAL: z
        .string()
        .transform((val) => Number(val))
        .pipe(z.number().min(1).max(60))
        .default("15"),
    PAPER_TRADE: z
        .string()
        .transform((val) => val.toLowerCase() === "true")
        .default("true"),
    MAX_SHARES: z
        .string()
        .transform((val) => Number(val))
        .pipe(z.number().min(1))
        .default("1"),
    SHARES_ACCOUNT: z
        .string()
        .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address")
        .optional()
}).refine((data) => {
    return true;
}, {
    message: "Configuration validation failed"
});

export type AvalancheConfig = z.infer<typeof avalancheEnvSchema>;

export async function validateConfig(
    runtime: IAgentRuntime
): Promise<AvalancheConfig> {
    try {
        const config = {
            AVALANCHE_PRIVATE_KEY: runtime.getSetting("AVALANCHE_PRIVATE_KEY") || process.env.AVALANCHE_PRIVATE_KEY,
            MIN_AVAX_BALANCE: runtime.getSetting("MIN_AVAX_BALANCE") || process.env.MIN_AVAX_BALANCE || "0.2",
            TRADE_INTERVAL_MINUTES: runtime.getSetting("TRADE_INTERVAL_MINUTES") || process.env.TRADE_INTERVAL_MINUTES || "60",
            HISTORY_INTERVAL: runtime.getSetting("HISTORY_INTERVAL") || process.env.HISTORY_INTERVAL || "15",
            PAPER_TRADE: runtime.getSetting("PAPER_TRADE") || process.env.PAPER_TRADE || "true",
            MAX_SHARES: runtime.getSetting("MAX_SHARES") || process.env.MAX_SHARES || "1",
            SHARES_ACCOUNT: runtime.getSetting("SHARES_ACCOUNT") || process.env.SHARES_ACCOUNT
        };

        return avalancheEnvSchema.parse(config);
    } catch (error) {
        if (error instanceof z.ZodError) {
            const errorMessages = error.errors
                .map((err) => `${err.path.join(".")}: ${err.message}`)
                .join("\n");
            throw new Error(
                `Avalanche configuration validation failed:\n${errorMessages}`
            );
        }
        throw error;
    }
}

export function isZodError(error: unknown): error is z.ZodError {
    return error instanceof z.ZodError;
}