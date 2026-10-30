import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores([
    "dist/**",
    "**/.wrangler/**",
    "**/.worker-build/**",
    "src/routeTree.gen.ts",
    "playwright-report/**",
    "test-results/**",
    // Vendored agent skills (npx skills add): not our code.
    ".claude/skills/**",
    // The bench's app: its own project, pushed to the bench repositories.
    "bench/app/**",
  ]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
]);
