import { defineConfig } from "vite";

export default defineConfig({
  base: "/horse-racing/",
  server: {
    port: 5174,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
