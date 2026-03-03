/// <reference types="astro/client" />

type R2Bucket = import('@cloudflare/workers-types').R2Bucket;

interface Env {
  DATA_BUCKET: R2Bucket;
}

declare namespace App {
  interface Locals extends import('@astrojs/cloudflare').Runtime<Env> {}
}
