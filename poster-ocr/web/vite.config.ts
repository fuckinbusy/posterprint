import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/* Сборка кладётся в static/dist — FastAPI отдаёт её оттуда.
 * base обязателен: файлы лежат под /static/dist/, а не в корне сайта. */
export default defineConfig({
  plugins: [react()],
  base: '/static/dist/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: '../static/dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    // Стили лежат в static/css/app.css — вне папки web, рядом со шрифтами
    // и сборкой: их отдаёт сервер как есть.
    fs: {
      allow: [fileURLToPath(new URL('.', import.meta.url)), fileURLToPath(new URL('..', import.meta.url))],
    },
    // в режиме разработки страницу отдаёт vite, а данные — uvicorn
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      // шрифты лежат в static/fonts и в разработке тоже приезжают с uvicorn
      '/static/fonts': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
});
