/// <reference types="astro/client" />

type R2Bucket = import('@cloudflare/workers-types').R2Bucket;

declare namespace Cloudflare {
  interface Env {
    DATA_BUCKET: R2Bucket;
    GITHUB_TOKEN?: string;
    SUBMISSIONS_ENABLED?: string;
  }
}
