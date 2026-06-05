import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/",
      "storage/",
      "PorizoApp/",
      ".tldr/",
      ".venv/",
      "backup/",
      "build/",
      "data/",
      "test-output/",
      "public/admin/assets/",
      "marketing/appstore/screenshots/**/dist/",
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  {
    files: ["**/*.mjs", "eslint.config.mjs", "admin/eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
  },
  {
    files: ["marketing/scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
  },
  {
    files: ["marketing/emails/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
  },
  {
    files: ["marketing/app-store-screenshots/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2022,
      },
    },
  },
  {
    files: ["public/**/*.js", "web-player/**/*.js", "embed-player/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.es2022,
        Hls: "readonly",
      },
    },
  },
  {
    files: ["test/**/*.js", "scripts/**/*.js", "tools/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      "no-unused-vars": "off",
      "no-unused-disable": "off",
    },
  },
  {
    files: ["scripts/**/*.js"],
    rules: {
      "no-fallthrough": "off",
    },
  },
];
