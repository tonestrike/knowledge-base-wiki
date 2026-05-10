import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/rpc': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      // Source artifact proxy (PDF bytes, extracted text, page outline) is
      // served directly by the API — vite must forward it instead of falling
      // back to the SPA index.html.
      '/__source': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
});
