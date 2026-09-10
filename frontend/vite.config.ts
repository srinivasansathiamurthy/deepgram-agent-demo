import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy /api/* to the FastAPI backend during development so the frontend dev
// server and the backend server can run on different ports without CORS issues.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        // Upgrade HTTP → WS for the /api/voice-agent WebSocket endpoint.
        ws: true,
      },
    },
  },
});
