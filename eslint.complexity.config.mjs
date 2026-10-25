import { createRequire } from "node:module";

const requireAdmin = createRequire(new URL("./admin/package.json", import.meta.url));
const { parser } = requireAdmin("typescript-eslint");

export default [
  {
    files: ["src/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "commonjs" },
    rules: { complexity: ["error", { max: 170, variant: "classic" }] },
  },
  {
    files: ["admin/src/**/*.{ts,tsx}"],
    languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: { complexity: ["error", { max: 65, variant: "classic" }] },
  },
];
