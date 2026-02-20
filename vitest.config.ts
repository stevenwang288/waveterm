import { UserConfig, defineConfig, mergeConfig } from "vitest/config";
import electronViteConfig from "./electron.vite.config";

export default mergeConfig(
    electronViteConfig.renderer as UserConfig,
    defineConfig({
        test: {
            include: ["frontend/**/tests/**/*.test.{ts,tsx,js,jsx}"],
            exclude: [
                "**/node_modules/**",
                "**/dist/**",
                "**/build/**",
                "**/docs/**",
                "**/third_party/**",
                "**/.task/**",
                "**/.tmp/**",
                "**/make/**",
            ],
            reporters: ["verbose", "junit"],
            outputFile: {
                junit: "test-results.xml",
            },
            coverage: {
                provider: "istanbul",
                reporter: ["lcov"],
                reportsDirectory: "./coverage",
            },
            typecheck: {
                tsconfig: "tsconfig.json",
            },
        },
    })
);
