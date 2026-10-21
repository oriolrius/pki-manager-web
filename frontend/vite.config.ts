import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-vite-plugin'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    TanStackRouterVite(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 52080,
    // Fail loudly instead of silently hopping to 52082 when a stale dev server
    // still owns the port — a shifted port is how you end up with two stacks.
    strictPort: true,
    // No allowedHosts: Vite's default (localhost + IP literals) is exactly what dev needs.
    // Open the app as http://localhost:52080 — WSL2 forwards it to the Windows browser,
    // and localhost is a secure context, which OIDC login (PKCE / crypto.subtle) requires.
  },
})
