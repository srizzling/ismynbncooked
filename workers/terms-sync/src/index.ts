interface Env {
  DATA_BUCKET: R2Bucket;
  FIRECRAWL_API_KEY: string;
}

interface TermsEntry {
  minimumTerm: string | null;
  cancellationFees: string | null;
  noticePeriod: string | null;
  typicalEveningSpeed: number | null;
  extractedAt: string;
  resolvedUrl?: string; // The actual PDF URL if different from cisUrl
}

interface TierData {
  plans: { cisUrl: string; typicalEveningSpeed: number | null }[];
}

interface BatchResult {
  data: {
    extract?: Record<string, unknown>;
    metadata?: { sourceURL?: string };
  }[];
}

const SPEED_TIERS = [25, 50, 100, 250, 500, 750, 1000, 2000];
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 200; // ~10 minutes max

// Schema for extracting contract terms + speed from a CIS PDF
const CIS_EXTRACT_PROMPT =
  'Extract the key details from this Australian NBN internet Critical Information Summary (CIS) document. Focus on: 1) The minimum contract term or lock-in period, 2) Any early termination or cancellation fees, 3) The notice period required to cancel, 4) The typical evening download speed (also called "typical busy period download speed", measured 7pm-11pm). These are Australian telecommunications CIS documents required by the ACMA.';

const CIS_EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    minimumTerm: {
      type: 'string',
      description: 'The minimum contract term or lock-in period. Examples: "No lock-in contract", "Month-to-month", "12 months", "24 months". If no minimum term or lock-in is mentioned, return "No lock-in".',
    },
    cancellationFees: {
      type: 'string',
      description: 'Early termination or cancellation fees. Examples: "No cancellation fee", "$0", "$99 early termination fee", "Remaining months x monthly fee". If no fees are mentioned, return "No cancellation fee".',
    },
    noticePeriod: {
      type: 'string',
      description: 'The notice period required to cancel the service. Examples: "30 days", "14 days", "None", "No notice required". If not mentioned, return "Not specified".',
    },
    typicalEveningSpeed: {
      type: 'number',
      description: 'The typical evening speed (download) in Mbps. Australian CIS documents must state the "typical busy period download speed" or "typical evening speed" (7pm-11pm). Return just the number in Mbps. For example if the document says "typical evening speed: 80 Mbps", return 80. If not found, return null.',
    },
  },
  required: ['minimumTerm', 'cancellationFees', 'noticePeriod'],
};

// Schema for finding the actual CIS PDF link on a landing page
const CIS_PDF_LINK_PROMPT =
  'This is a page listing Critical Information Summary (CIS) PDF documents for an Australian internet provider. Find the URL of the NBN residential fixed-line CIS PDF. Look for links that mention "nbn", "residential", "CIS", "FTTP", "HFC", "FTTC", or "FTTN". Do NOT pick mobile SIM CIS or fixed wireless CIS.';

const CIS_PDF_LINK_SCHEMA = {
  type: 'object',
  properties: {
    pdfUrl: {
      type: 'string',
      description: 'The URL of the NBN residential (fixed-line) Critical Information Summary (CIS) PDF document. Look for links containing "nbn", "residential", "CIS", "FTTP", "HFC", "FTTC", or "FTTN". Prefer the residential fixed-line CIS over fixed wireless or mobile CIS documents. Return the full absolute URL.',
    },
  },
  required: ['pdfUrl'],
};

/**
 * Submit a batch scrape job to Firecrawl
 */
async function submitBatch(
  apiKey: string,
  urls: string[],
  prompt: string,
  schema: Record<string, unknown>
): Promise<string | null> {
  if (urls.length === 0) return null;

  try {
    const res = await fetch('https://api.firecrawl.dev/v1/batch/scrape', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        urls,
        formats: ['extract'],
        extract: { prompt, schema },
      }),
    });
    if (!res.ok) {
      console.log(`[terms-sync] Batch submit failed: ${res.status}`);
      return null;
    }
    const data: any = await res.json();
    console.log(`[terms-sync] Batch submitted: ${data.id} (${urls.length} URLs)`);
    return data.id ?? null;
  } catch (e) {
    console.error('[terms-sync] Batch submit error:', e);
    return null;
  }
}

/**
 * Poll a batch job until completion
 */
async function pollBatch(apiKey: string, batchId: string): Promise<BatchResult | null> {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    try {
      const res = await fetch(`https://api.firecrawl.dev/v1/batch/scrape/${batchId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        console.log(`[terms-sync] Batch poll ${res.status} for ${batchId}`);
        return null;
      }
      const data: any = await res.json();

      if (data.status === 'completed') {
        console.log(`[terms-sync] Batch ${batchId} completed: ${data.completed}/${data.total}`);
        return data as BatchResult;
      }
      if (data.status === 'failed') {
        console.log(`[terms-sync] Batch ${batchId} failed`);
        return null;
      }

      // Still processing
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    } catch (e) {
      console.error(`[terms-sync] Batch poll error for ${batchId}:`, e);
      return null;
    }
  }

  console.log(`[terms-sync] Batch ${batchId} timed out after polling`);
  return null;
}

/**
 * Resolve content types for URLs in parallel
 */
async function resolveContentType(url: string): Promise<'pdf' | 'html'> {
  if (url.toLowerCase().endsWith('.pdf')) return 'pdf';

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': 'ismynbncooked-bot/1.0' },
    });
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/pdf')) return 'pdf';
  } catch {
    // Assume HTML if HEAD fails
  }

  return 'html';
}

function parseEveningSpeed(raw: unknown): number | null {
  if (raw == null) return null;
  const parsed = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!isNaN(parsed) && parsed > 0 && parsed <= 10000) {
    return Math.round(parsed * 10) / 10;
  }
  return null;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log('[terms-sync] Starting batch terms extraction...');

    // Load existing terms
    let terms: Record<string, TermsEntry> = {};
    try {
      const existing = await env.DATA_BUCKET.get('data/terms/terms.json');
      if (existing) terms = await existing.json();
    } catch {}

    // Collect all unique CIS URLs from plan data
    const cisUrls = new Set<string>();
    for (const speed of SPEED_TIERS) {
      try {
        const obj = await env.DATA_BUCKET.get(`data/plans/nbn-${speed}.json`);
        if (!obj) continue;
        const tierData: TierData = await obj.json();
        for (const plan of tierData.plans) {
          if (plan.cisUrl) cisUrls.add(plan.cisUrl);
        }
      } catch {}
    }

    console.log(`[terms-sync] Found ${cisUrls.size} unique CIS URLs`);

    // Filter to URLs that need extraction (new or older than 30 days)
    const now = Date.now();
    const staleUrls: string[] = [];
    let skipped = 0;

    for (const url of cisUrls) {
      const existing = terms[url];
      if (existing && now - new Date(existing.extractedAt).getTime() < THIRTY_DAYS_MS) {
        skipped++;
      } else {
        staleUrls.push(url);
      }
    }

    console.log(`[terms-sync] ${staleUrls.length} URLs need extraction, ${skipped} still fresh`);

    if (staleUrls.length === 0) {
      console.log('[terms-sync] Nothing to do');
      return;
    }

    // Step 1: Resolve content types in parallel
    console.log('[terms-sync] Resolving content types...');
    const typeResults = await Promise.allSettled(
      staleUrls.map(async (url) => ({ url, type: await resolveContentType(url) }))
    );

    const pdfUrls: string[] = [];
    const htmlUrls: string[] = [];

    for (const result of typeResults) {
      if (result.status === 'fulfilled') {
        if (result.value.type === 'pdf') {
          pdfUrls.push(result.value.url);
        } else {
          htmlUrls.push(result.value.url);
        }
      }
    }

    console.log(`[terms-sync] ${pdfUrls.length} PDFs, ${htmlUrls.length} HTML pages`);

    // Step 2: Submit batches in parallel
    // - PDFs: extract terms directly
    // - HTML: find PDF links first
    const [pdfBatchId, htmlBatchId] = await Promise.all([
      submitBatch(env.FIRECRAWL_API_KEY, pdfUrls, CIS_EXTRACT_PROMPT, CIS_EXTRACT_SCHEMA),
      submitBatch(env.FIRECRAWL_API_KEY, htmlUrls, CIS_PDF_LINK_PROMPT, CIS_PDF_LINK_SCHEMA),
    ]);

    // Step 3: Poll both batches in parallel
    const [pdfResults, htmlResults] = await Promise.all([
      pdfBatchId ? pollBatch(env.FIRECRAWL_API_KEY, pdfBatchId) : null,
      htmlBatchId ? pollBatch(env.FIRECRAWL_API_KEY, htmlBatchId) : null,
    ]);

    // Step 4: Process direct PDF results
    let extracted = 0;

    if (pdfResults?.data) {
      for (const item of pdfResults.data) {
        const sourceUrl = item.metadata?.sourceURL;
        if (!sourceUrl || !item.extract) continue;
        const ext = item.extract as any;
        terms[sourceUrl] = {
          minimumTerm: ext.minimumTerm || null,
          cancellationFees: ext.cancellationFees || null,
          noticePeriod: ext.noticePeriod || null,
          typicalEveningSpeed: parseEveningSpeed(ext.typicalEveningSpeed),
          extractedAt: new Date().toISOString(),
        };
        extracted++;
      }
    }

    // Step 5: Resolve HTML → PDF links, then batch extract terms from those PDFs
    const resolvedPdfUrls: { cisUrl: string; pdfUrl: string }[] = [];

    if (htmlResults?.data) {
      for (const item of htmlResults.data) {
        const sourceUrl = item.metadata?.sourceURL;
        const ext = item.extract as any;
        if (!sourceUrl || !ext?.pdfUrl) continue;
        resolvedPdfUrls.push({ cisUrl: sourceUrl, pdfUrl: ext.pdfUrl });
      }
    }

    if (resolvedPdfUrls.length > 0) {
      console.log(`[terms-sync] Resolved ${resolvedPdfUrls.length} HTML → PDF links, extracting terms...`);

      const resolvedBatchId = await submitBatch(
        env.FIRECRAWL_API_KEY,
        resolvedPdfUrls.map((r) => r.pdfUrl),
        CIS_EXTRACT_PROMPT,
        CIS_EXTRACT_SCHEMA
      );

      if (resolvedBatchId) {
        const resolvedResults = await pollBatch(env.FIRECRAWL_API_KEY, resolvedBatchId);

        if (resolvedResults?.data) {
          // Map resolved PDF URLs back to original CIS URLs
          const pdfToCis = new Map(resolvedPdfUrls.map((r) => [r.pdfUrl, r.cisUrl]));

          for (const item of resolvedResults.data) {
            const pdfUrl = item.metadata?.sourceURL;
            if (!pdfUrl || !item.extract) continue;
            const cisUrl = pdfToCis.get(pdfUrl);
            if (!cisUrl) continue;

            const ext = item.extract as any;
            terms[cisUrl] = {
              minimumTerm: ext.minimumTerm || null,
              cancellationFees: ext.cancellationFees || null,
              noticePeriod: ext.noticePeriod || null,
              typicalEveningSpeed: parseEveningSpeed(ext.typicalEveningSpeed),
              extractedAt: new Date().toISOString(),
              resolvedUrl: pdfUrl,
            };
            extracted++;
          }
        }
      }
    }

    console.log(`[terms-sync] Extracted ${extracted} new, skipped ${skipped} fresh`);

    // Save updated terms
    await env.DATA_BUCKET.put('data/terms/terms.json', JSON.stringify(terms), {
      httpMetadata: { contentType: 'application/json' },
    });

    // Re-merge terms into plan JSONs
    for (const speed of SPEED_TIERS) {
      try {
        const obj = await env.DATA_BUCKET.get(`data/plans/nbn-${speed}.json`);
        if (!obj) continue;
        const tierData: any = await obj.json();

        let changed = false;
        for (const plan of tierData.plans) {
          const t = terms[plan.cisUrl];
          if (t) {
            plan.minimumTerm = t.minimumTerm;
            plan.cancellationFees = t.cancellationFees;
            plan.noticePeriod = t.noticePeriod;
            // Backfill evening speed only if the API didn't provide one
            if (plan.typicalEveningSpeed == null && t.typicalEveningSpeed != null) {
              plan.typicalEveningSpeed = t.typicalEveningSpeed;
            }
            changed = true;
          }
        }

        if (changed) {
          await env.DATA_BUCKET.put(`data/plans/nbn-${speed}.json`, JSON.stringify(tierData), {
            httpMetadata: { contentType: 'application/json' },
          });
        }
      } catch {}
    }

    // Update meta
    let meta: any = {};
    try {
      const m = await env.DATA_BUCKET.get('data/meta.json');
      if (m) meta = await m.json();
    } catch {}
    meta.lastTermsSync = new Date().toISOString();
    await env.DATA_BUCKET.put('data/meta.json', JSON.stringify(meta), {
      httpMetadata: { contentType: 'application/json' },
    });

    console.log('[terms-sync] Complete');
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/status') {
      try {
        const termsObj = await env.DATA_BUCKET.get('data/terms/terms.json');
        const terms = termsObj ? await termsObj.json() as Record<string, TermsEntry> : {};
        const count = Object.keys(terms).length;
        const metaObj = await env.DATA_BUCKET.get('data/meta.json');
        const meta = metaObj ? await metaObj.json() as any : null;
        return new Response(JSON.stringify({
          ok: true,
          lastSync: meta?.lastTermsSync ?? null,
          termsExtracted: count,
        }, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: String(err) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    ctx.waitUntil(this.scheduled({} as ScheduledEvent, env, ctx));
    return new Response('Terms sync triggered (batch)', { status: 202 });
  },
} satisfies ExportedHandler<Env>;
