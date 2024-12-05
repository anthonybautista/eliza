import { IAgentRuntime } from "@ai16z/eliza";
import { z } from "zod";

export const arenaEnvSchema = z.object({
    ARENA_DRY_RUN: z.string().transform((val) => val.toLowerCase() === "true"),
    TWITTER_USERNAME: z.string().min(1, "Twitter username is required"),
    ARENA_BEARER_TOKEN: z.string(),
    ARENA_GROUP_ID: z
    .string()
    .min(36, "Group Id must be 36 characters")
    .max(36, "Group Id must be 36 characters")
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid group ID format")
  }).refine((data) => {
    // Require Bearer token
    return (!!data.ARENA_BEARER_TOKEN || !!data.ARENA_GROUP_ID || !!data.TWITTER_USERNAME || !!data.ARENA_DRY_RUN);
  }, {
    message: "Bearer token must be provided"
  });

export type ArenaConfig = z.infer<typeof arenaEnvSchema>;

export async function validateArenaConfig(
    runtime: IAgentRuntime
): Promise<ArenaConfig> {
    try {
        const config = {
          ARENA_DRY_RUN: runtime.getSetting("ARENA_DRY_RUN") || process.env.ARENA_DRY_RUN,
          TWITTER_USERNAME: runtime.getSetting("TWITTER_USERNAME") || process.env.TWITTER_USERNAME,
          ARENA_BEARER_TOKEN: runtime.getSetting("ARENA_BEARER_TOKEN") || process.env.ARENA_COOKIES,
          ARENA_GROUP_ID: runtime.getSetting("ARENA_GROUP_ID") || process.env.ARENA_GROUP_ID
        };
        return arenaEnvSchema.parse(config);
      } catch (error) {
        if (error instanceof z.ZodError) {
          const errorMessages = error.errors.map((err) => `${err.path.join(".")}: ${err.message}`).join("\n");
          throw new Error(
            `Arena configuration validation failed:\n${errorMessages}`
          );
        }
        throw error;
      }
}
