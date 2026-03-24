/**
 * Read static JSON files from public/data/ for local dev fallback.
 * Uses dynamic import of fs to avoid bundling issues in production.
 */

export async function readLocalJson<T>(relativePath: string): Promise<T | null> {
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');

    // Try multiple base paths since cwd can vary
    const candidates = [
      path.resolve(process.cwd(), 'public', relativePath),
      path.resolve(process.cwd(), 'site', 'public', relativePath),
    ];

    // Also try relative to this file: local-data.ts is in site/src/lib/
    try {
      const thisDir = path.dirname(url.fileURLToPath(import.meta.url));
      candidates.push(path.resolve(thisDir, '..', '..', '..', 'public', relativePath));
    } catch {}

    for (const filePath of candidates) {
      try {
        if (fs.existsSync(filePath)) {
          const raw = fs.readFileSync(filePath, 'utf-8');
          return JSON.parse(raw) as T;
        }
      } catch {}
    }

    console.warn(`[local-data] File not found: ${relativePath} (tried: ${candidates.join(', ')})`);
    return null;
  } catch (err) {
    console.warn(`[local-data] Failed to read ${relativePath}:`, err);
    return null;
  }
}
