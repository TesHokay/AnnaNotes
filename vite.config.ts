/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import type { Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string };
const buildTime = new Date().toISOString();
const buildId = buildTime.slice(0, 16).replace(/[-:T]/g, '');

/** Commit of this build: Cloudflare CI env vars first, then local git. */
function commitSha(): string {
  const env = process.env.WORKERS_CI_COMMIT_SHA || process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA;
  if (env) return env.slice(0, 12);
  try {
    const sha = execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() ? '-dirty' : '';
    return sha + dirty;
  } catch {
    return 'unknown';
  }
}
const commit = commitSha();
const appVersion = `${pkg.version}+${buildId}`;

/** Emits /version.json so the app can compare the running build with the published one. */
function versionFile(): Plugin {
  return {
    name: 'annanotes-version-file',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: appVersion, commit, buildTime }) });
    },
  };
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_COMMIT__: JSON.stringify(commit),
    __APP_BUILD_TIME__: JSON.stringify(buildTime),
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
    versionFile(),
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
        // App shell: everything Vite emits, including the pdf.js worker (.mjs).
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,woff,woff2,webmanifest}'],
        // CMaps / standard fonts (2+ MB) are only needed for some PDFs: cached on first use instead of
        // bloating the install. A smaller precache installs faster and more reliably on iPad.
        globIgnores: ['pdfjs/**', 'version.json'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        /*
         * Cloudflare (Workers static assets and Pages) answers /index.html with a 307 redirect to /.
         * Precaching the redirect target under "/" and using "/" as the navigation fallback avoids
         * serving a redirected response to a navigation, which Safari rejects as a network error.
         */
        manifestTransforms: [
          async (entries) => ({
            manifest: entries.map((e) => (e.url === 'index.html' ? { ...e, url: '/' } : e)),
            warnings: [],
          }),
        ],
        navigateFallback: '/',
        navigateFallbackDenylist: [/^\/assets\//, /^\/pdfjs\//, /\/[^/?]+\.(?!html$)[a-z0-9]+$/i],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/pdfjs/'),
            handler: 'CacheFirst',
            options: { cacheName: 'pdfjs-assets', expiration: { maxEntries: 400 } },
          },
        ],
        cleanupOutdatedCaches: true,
        // New versions wait until the user taps "Update" (after saving); no forced reloads.
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
