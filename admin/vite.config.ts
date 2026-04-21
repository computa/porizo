import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/admin/',
  build: {
    outDir: '../public/admin',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Content-hashed filenames so every build produces a unique URL.
        // Without this, admin.js is cached by Chrome/CDN indefinitely and
        // users see stale code until they hard-refresh.
        entryFileNames: 'assets/admin.[hash].js',
        chunkFileNames: 'assets/chunk-[name].[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            return 'assets/admin.[hash].css';
          }
          return 'assets/[name].[hash][extname]';
        },
      },
    },
  },
  server: {
    proxy: {
      '/admin/dashboard': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/admin/auth': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
