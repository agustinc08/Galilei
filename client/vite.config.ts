import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.BJC_DEV_API_PROXY?.trim() || 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 4001,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: false,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4002,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'pdfjs',
              test: /node_modules[\\/]pdfjs-dist[\\/]/,
              priority: 20,
            },
          ],
        },
      },
    },
  },
});
