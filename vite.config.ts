import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: { port: 3000 },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    // The Start plugin must come before the React plugin.
    tanstackStart(),
    viteReact(),
  ],
});
