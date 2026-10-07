import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Relative asset paths so the same build works on aldea.world, IPFS gateways and fork domains.
  base: "./",
  plugins: [react(), tailwindcss()],
  // strictPort: on a busy port Vite would quietly take the next one, which is the MUD indexer's
  server: { port: 3100, strictPort: true },
  build: { target: "es2022", sourcemap: true },
});
