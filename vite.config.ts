import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  resolve: {
    alias: {
      '@components': path.resolve(__dirname, 'src/components'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        popup: 'popup.html',
        content: 'src/content.ts',
        background: 'src/background.ts',
      },
      output: {
        entryFileNames: '[name].js',
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
  plugins: [
    react(),

    viteStaticCopy({
      targets: [
        { src: 'manifest.json', dest: '.' },
        { src: 'public/mimi-logo.png', dest: '.' }
      ],
    }),
  ],
});

