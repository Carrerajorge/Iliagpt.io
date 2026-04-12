import js from "@eslint/js";
import globals from "globals";
import ts from "typescript-eslint";

export default ts.config(
  { ignores: [
    "dist/**",
    "node_modules/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "hola-infra/**",
    "artifacts/**",
    "vendor/**",
    "**/*.d.ts",
    ".claude/worktrees/**",
    ".claire/worktrees/**",
    "client/public/**",
    "fastapi_sse/**",
    "desktop/**",
    "extension/**",
    "migrations/**",
  ] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "no-useless-escape": "warn",
      "no-empty": "warn",
      "no-constant-condition": "warn",
      "no-case-declarations": "warn",
      "no-control-regex": "warn",
      "no-prototype-builtins": "warn",
      "no-cond-assign": "warn",
      "no-sparse-arrays": "warn",
      "no-unsafe-finally": "warn",
      "@typescript-eslint/no-this-alias": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-namespace": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-unsafe-function-type": "warn",
      "no-misleading-character-class": "warn",
      "no-extra-boolean-cast": "warn",
      "no-regex-spaces": "warn",
      "prefer-const": "warn",
      "no-undef": "off",
      "no-shadow-restricted-names": "warn",
      "no-useless-catch": "warn",
      "no-constant-binary-expression": "warn",
      "no-async-promise-executor": "warn",
      "no-var": "warn",
      "require-yield": "warn",
      "@typescript-eslint/triple-slash-reference": "warn",
      "react-hooks/exhaustive-deps": "off",
    },
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  }
);
