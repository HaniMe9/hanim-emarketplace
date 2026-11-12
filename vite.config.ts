import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    /**
     * Pinned to the IPv4 loopback rather than left as the default `localhost`.
     *
     * Node resolves `localhost` once and binds the single address it lands on,
     * which on Windows is `127.0.0.1` — so the listener never accepts `::1`. A
     * browser that resolves `localhost` to IPv6 for the HMR socket then gets
     * ECONNREFUSED on the upgrade, and the page reports "failed to connect to
     * websocket" while plain HTTP keeps working, because the request path gets
     * an IPv4 fallback and the upgrade does not.
     *
     * Naming the address also makes Vite hand the client that exact host, so the
     * HMR URL is `ws://127.0.0.1:5173` instead of a name that can resolve two
     * ways. The page's origin becomes `http://127.0.0.1:5173`, which is in the
     * API's development CORS allowlist, so the proxy stays same-origin.
     */
    host: '127.0.0.1',
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
