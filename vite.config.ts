// Configurazione di Vite per Turni (TanStack Start, build per Cloudflare Workers tramite Nitro).
// Ordine dei plugin: tanstackStart prima di nitro, viteReact per ultimo (come nella guida
// di TanStack Start). Le variabili VITE_* e il rilevamento dei file .env sono già gestiti da Vite.
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-query"],
  },
  plugins: [
    tsConfigPaths(),
    tailwindcss(),
    // Usa src/server.ts (il nostro gestore degli errori del server) come entry del server.
    tanstackStart({ server: { entry: "server" } }),
    // Build per Cloudflare Workers: genera .output/server/wrangler.json e .output/public.
    nitro({ preset: "cloudflare-module" }),
    viteReact(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null,
      filename: "sw.js",
      // IMPORTANTE: senza questo, il plugin genera sw.js in "dist/" (cartella intermedia
      // di Vite), che Nitro NON copia in .output/public (la cartella servita davvero da
      // Cloudflare). Risultato: /sw.js risponde con l'HTML dell'app invece del vero
      // service worker, la registrazione fallisce in silenzio e l'offline non funziona mai.
      outDir: ".output/public",
      devOptions: { enabled: false },
      manifest: false,
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,webmanifest}"],
        // Il plugin ha 'index.html' come default SEMPRE attivo per navigateFallback
        // (fuso via Object.assign con le nostre opzioni): omettere semplicemente questa
        // chiave NON basta a disattivarlo, va sovrascritta esplicitamente con undefined.
        // Senza questo, il Service Worker genera una NavigationRoute che punta a un file
        // precaricato "index.html" mai esistito (questa app è renderizzata dal server, non
        // un sito statico) — il SW va in errore all'attivazione e l'offline non funziona mai.
        navigateFallback: undefined,
        runtimeCaching: [
          {
            urlPattern: ({ request }: { request: Request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "html-navigations",
              networkTimeoutSeconds: 5,
            },
          },
          {
            urlPattern: ({ request, sameOrigin }: { request: Request; sameOrigin: boolean }) =>
              sameOrigin &&
              (request.destination === "script" ||
                request.destination === "style" ||
                request.destination === "font" ||
                request.destination === "image"),
            handler: "CacheFirst",
            options: {
              cacheName: "static-assets",
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
});
