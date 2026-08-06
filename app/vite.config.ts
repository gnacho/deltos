import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/react-router')
            ) {
              return 'vendor';
            }
            if (id.includes('/i18next') || id.includes('/react-i18next')) {
              return 'i18n';
            }
          }
        },
      },
    },
  },
  server: {
    proxy: { '/api': 'http://localhost:3000', '/health': 'http://localhost:3000' },
  },
});
