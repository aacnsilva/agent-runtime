import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import prettier from "eslint-config-prettier";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

import { noComments } from "./eslint/no-comments.js";

export default defineConfig(
  { ignores: ["node_modules/", ".wrangler/", "dist/", "coverage/"] },
  { linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "error" } },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  { files: ["**/*.js"], extends: [tseslint.configs.disableTypeChecked] },
  {
    files: ["e2e/**", "evals/**", "eslint/**", "*.js"],
    languageOptions: { globals: globals.node },
  },
  {
    plugins: {
      local: { rules: { "no-comments": noComments } },
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "local/no-comments": "error",
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      eqeqeq: "error",
      curly: "error",
      "no-console": "error",
      "no-param-reassign": "error",
      "prefer-const": "error",
      complexity: ["error", 10],
      "max-depth": ["error", 3],
      "max-params": ["error", 3],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true }],
    },
  },
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/strict-boolean-expressions": "error",
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/no-import-type-side-effects": "error",
    },
  },
  { files: ["src/observability/log.ts"], rules: { "no-console": "off" } },
  { files: ["tests/**", "e2e/**/*.e2e.ts"], rules: { "max-lines-per-function": "off" } },
  prettier,
);
