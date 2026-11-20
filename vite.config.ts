import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", sourcemap: false },
  server: {
    // `wrangler dev --port 8787` 를 같이 띄우면 /api 요청을 워커로 넘긴다
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
