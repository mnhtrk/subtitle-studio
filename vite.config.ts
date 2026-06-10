import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [
    react(),
    tailwindcss(),
  ],

  // tauri 2 на винде отдаёт фронт через tauri://localhost
  // абсолютные /assets/... иногда не резолвятся в webview2 (особенно в mask-image)
  // относительные пути работают стабильнее и в dev и в release
  base: "./",
  assetsInclude: ["**/*.aff", "**/*.dic"],
  clearScreen: false,
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        viewer: resolve(__dirname, "viewer.html"),
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || "localhost",
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
