import { defineConfig } from 'vite';

// The sales site's 3D views: one self-contained module the static page loads from assets/site3d.js
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'website/assets',
    emptyOutDir: false,
    lib: { entry: 'src/site3d.ts', formats: ['es'], fileName: () => 'site3d.js' },
    target: 'es2020',
  },
});
