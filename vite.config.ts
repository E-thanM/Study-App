import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// BASE_PATH lets the same build work on GitHub Pages (/Study-App/) or at a root domain (/).
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  build: { chunkSizeWarningLimit: 1600 },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Study',
        short_name: 'Study',
        description: 'Revision timetable, spaced-repetition flashcards, quick-learn sets and a revision calendar.',
        theme_color: '#f7f6f3',
        background_color: '#f7f6f3',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'], maximumFileSizeToCacheInBytes: 4_000_000 },
    }),
  ],
});
