import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // genlayer-js (via viem) expects Node's global in a few places.
  define: { global: "globalThis" },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
