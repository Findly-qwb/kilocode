import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Tauri expects a fixed port in dev and does not want asset inlining of the
// native runtime. `clearScreen`/`host` follow the upstream desktop package.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
  },
});
