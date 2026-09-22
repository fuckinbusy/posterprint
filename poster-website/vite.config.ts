import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/* Сайт живёт в корне домена, поэтому base по умолчанию («/»). Сборка — в
 * dist/, её отдаёт Caddy из Dockerfile; в репозиторий dist не идёт. */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    // 5173 занят интерфейсом системы (poster-ocr/web), чтобы оба dev-сервера
    // могли работать одновременно
    port: 5174,
    // локальная система для ссылки «Вход для сотрудников» в разработке
    proxy: {
      '/poster-crm': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/poster-crm/, ''),
      },
    },
  },
});
