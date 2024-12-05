import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/index.ts"],
    outDir: "dist",
    sourcemap: true,
    clean: true,
    format: ["esm"],
    dts: false,  // Disable tsup's DTS generation
    external: [
        "events",
        "viem",
        "@traderjoe-xyz/sdk",
        "@traderjoe-xyz/sdk-core",
        "@traderjoe-xyz/sdk-v2",
        "zod"
    ]
});