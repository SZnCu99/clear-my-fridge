import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Clear My Fridge',
        short_name: 'Fridge',
        description: 'Keep track of what is in your fridge and what expires first.',
        theme_color: '#0f766e',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The API is always fetched from the network; only the app shell is cached.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
});
