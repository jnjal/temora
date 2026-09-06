import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

// Relative base ('./') works for any repo name casing, custom domains,
// and GitHub Pages project sites (e.g. <user>.github.io/temora/).
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
});
