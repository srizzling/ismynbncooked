import { readLocalJson } from './local-data';

/** Load a JSON object from R2 (production) or public/data (local dev). `key` is relative to data/. */
export async function loadData<T>(locals: App.Locals | any, key: string): Promise<T | null> {
  try {
    const bucket = locals?.runtime?.env?.DATA_BUCKET;
    if (bucket) {
      const obj = await bucket.get(`data/${key}`);
      if (obj) return await obj.json() as T;
    }
  } catch {}
  return await readLocalJson<T>(`data/${key}`);
}
