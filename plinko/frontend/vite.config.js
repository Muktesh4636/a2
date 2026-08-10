import { defineConfig } from "vite";

export default defineConfig({
  base: '/plinko/',
  server: {
    port: 5173,
    open: true,
  },
});
