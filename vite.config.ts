import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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
