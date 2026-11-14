import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /api goes to the local runner (npm run runner; port 8797, or RUNNER_PORT if you moved it with PORT=...).
// Without the runner the page runs the town in the browser.
export default defineConfig({
  // relative asset paths, so the built page works from any folder (GitHub Pages serves it under /<repo>/)
  base: "./",
  plugins: [react()],
  server: { proxy: { "/api": `http://127.0.0.1:${process.env.RUNNER_PORT ?? 8797}` } },
});
