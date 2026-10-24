/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string };
const buildId = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(`${pkg.version}+${buildId}`),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: ['es2020', 'safari15'],
    chunkSizeWarningLimit: 1600,
  },
  plugins: [
    react(),
    VitePWA({
      // The app decides when to apply an update (never mid-stroke), so we prompt instead of autoUpdate.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icons/*.png'],
      manifest: {
        name: 'AnnaNotes',
        short_name: 'AnnaNotes',
        description: 'Рукописные заметки и PDF-аннотации. Работает офлайн, данные хранятся только на устройстве.',
        lang: 'ru',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#fcf1f5',
        background_color: '#fcf1f5',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell: everything Vite emits, including the pdf.js worker (.mjs) and fonts.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,woff,woff2,ttf,pfb,bcmap,webmanifest}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
