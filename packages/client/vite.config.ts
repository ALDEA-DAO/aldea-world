import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative asset paths so the same build works on aldea.world, IPFS gateways and fork domains.
  base: "./",
  plugins: [react()],
  server: { port: 3000 },
  build: { target: "es2022", sourcemap: true },
});
