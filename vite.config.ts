import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // relative asset paths so the same build loads inside the Capacitor WebView
  base: './',
  server: { port: 5173 },
});
