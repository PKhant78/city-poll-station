import { defineConfig } from "vite";
import { nitro } from "nitro/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(process.env.VERCEL === "1"
      ? [
          nitro({
            preset: "vercel",
            serverDir: ".",
            vercel: { functions: { maxDuration: 30 } },
          }),
        ]
      : []),
  ],
  server: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
    // vercel dev routes /api through the frontend function and its binding.
    // Only standalone Vite development should call the local Python port.
    proxy:
      process.env.VERCEL === "1"
        ? undefined
        : { "/api": "http://localhost:8000" },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.js",
    clearMocks: true,
  },
});
