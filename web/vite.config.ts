import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// WEB_VITE_CACHE_DIR isolates the web-fidelity-final builds from the demo's Vite cache (SPEC §5.10).
export default defineConfig({ plugins: [react()], cacheDir: process.env.WEB_VITE_CACHE_DIR || undefined, test: { environment: 'jsdom' } } as never);
