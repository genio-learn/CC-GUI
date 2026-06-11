import { defineConfig } from "vite";

// Tauri expects a fixed dev port (see src-tauri/tauri.conf.json devUrl)
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
});
