import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Relative asset paths so the same build works on aldea.world, IPFS gateways and fork domains.
  base: "./",
  plugins: [react(), tailwindcss()],
  server: { port: 3100 },
  build: { target: "es2022", sourcemap: true },
});
