import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://amigettingrorted.au',
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough' }),
  integrations: [preact()],
  build: { inlineStylesheets: 'always' },
});
