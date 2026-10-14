import { env } from 'cloudflare:workers';
import { readLocalJson } from './local-data';

/** Load a JSON object from R2 (production) or public/data (local dev). `key` is relative to data/. */
export async function loadData<T>(_locals: unknown, key: string): Promise<T | null> {
  try {
    const bucket = env.DATA_BUCKET;
    if (bucket) {
      const obj = await bucket.get(`data/${key}`);
      if (obj) return await obj.json() as T;
    }
  } catch {}
  return await readLocalJson<T>(`data/${key}`);
}
