import { defineConfig } from "vitest/config";

// Unit tests for the page's pure modules (translator, score tracking, driver, chain-state check): no DOM needed.
export default defineConfig({ test: { environment: "node", include: ["test/**/*.test.ts"] } });
