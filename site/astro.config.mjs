import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://amigettingrorted.au',
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough' }),
  integrations: [preact()],
  vite: { plugins: [tailwindcss()] },
  build: { inlineStylesheets: 'always' },
});
