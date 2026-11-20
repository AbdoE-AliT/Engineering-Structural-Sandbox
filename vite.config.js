import { defineConfig } from 'vite';

export default defineConfig({
  // The application entry lives in src/, so serve/build that directory as the
  // Vite root instead of opening src/index.html directly (file:// blocks its modules).
  root: 'src',
  publicDir: '../public',
  // Rapier's JS wrapper and WASM glue must share one module instance. Vite's
  // dependency optimizer split them, leaving rigid-body reads bound to a
  // different WASM memory instance during simulation.
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d']
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            { name: 'rapier', test: /node_modules[\\/]@dimforge[\\/]rapier3d[\\/]/ }
          ]
        }
      }
    }
  }
});
