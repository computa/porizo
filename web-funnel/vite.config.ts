import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { resolveTurnstileSiteKey } from "./turnstile-env";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const turnstileSiteKey = resolveTurnstileSiteKey(mode, env.VITE_TURNSTILE_SITE_KEY);

  return {
    base: "/create/",
    plugins: [react()],
    define: {
      "import.meta.env.VITE_TURNSTILE_SITE_KEY": JSON.stringify(turnstileSiteKey),
    },
    build: {
      target: "es2019",
      sourcemap: false,
    },
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
    },
  };
});
