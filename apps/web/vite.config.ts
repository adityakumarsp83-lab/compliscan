import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const backendProxy = {
  target: process.env.LOCAL_BACKEND_URL || 'http://127.0.0.1:4000',
  changeOrigin: true,
  headers: { Origin: 'http://localhost:5173' },
  rewrite: (path: string) => path.replace(/^\/backend(?=\/|$)/, ''),
};

export default defineConfig({
  optimizeDeps: { include: ['@zxing/library'] },
  server: { host: true, port: 5173, proxy: { '/backend': backendProxy } },
  preview: { host: true, proxy: { '/backend': backendProxy } },
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    manifest: {
      id: '/', name: 'CompliScan', short_name: 'CompliScan',
      description: 'Multi-surface packaging compliance scanner with local OCR and evidence exports.',
      start_url: '/', scope: '/', display: 'standalone',
      theme_color: '#2563eb', background_color: '#f8fafc',
      icons: [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      // Precache the full OCR runtime, including both SIMD and non-SIMD LSTM cores.
      globPatterns: ['**/*.{js,css,html,png,svg,wasm,gz}'],
      maximumFileSizeToCacheInBytes: 25 * 1024 * 1024,
      navigateFallback: 'index.html',
      navigateFallbackDenylist: [/^\/api\//, /^\/health/],
      cleanupOutdatedCaches: true,
      // API/auth responses are deliberately never cached.
      runtimeCaching: [],
    },
  })],
});
