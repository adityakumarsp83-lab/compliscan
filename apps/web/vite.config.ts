import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
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
