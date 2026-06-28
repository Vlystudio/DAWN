import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// DAWN renderer (React + TS + Tailwind). Built to /dist and loaded by Electron.
// base './' keeps asset paths relative for file:// loading in the packaged app.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
  server: { port: 5173, strictPort: true },
});
