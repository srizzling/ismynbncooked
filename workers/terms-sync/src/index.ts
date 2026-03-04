interface Env {
  DATA_BUCKET: R2Bucket;
  FIRECRAWL_API_KEY: string;
  TERMS_QUEUE: Queue<QueueMessage>;
}

interface QueueMessage {
  cisUrl: string;
}

interface TermsEntry {
  minimumTerm: string | null;
  cancellationFees: string | null;
  noticePeriod: string | null;
  typicalEveningSpeed: number | null;
  extractedAt: string;
  resolvedUrl?: string;
}

interface TierData {
  plans: {
    cisUrl: string;
    typicalEveningSpeed: number | null;
    minimumTerm: string | null;
    cancellationFees: string | null;
    noticePeriod: string | null;
  }[];
  [key: string]: unknown;
}

const SPEED_TIERS = [25, 50, 100, 250, 500, 750, 1000, 2000];
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Schema for extracting contract terms + speed from a CIS PDF
const CIS_EXTRACT_PROMPT =
  'Extract the key details from this Australian NBN internet Critical Information Summary (CIS) document. Focus on: 1) The minimum contract term or lock-in period, 2) Any early termination or cancellation fees, 3) The notice period required to cancel — look carefully in sections about "Cancellation", "Termination", "Cooling Off", or "How to cancel". Many providers require 30 days written notice. 4) The typical evening download speed (also called "typical busy period download speed", measured 7pm-11pm). These are Australian telecommunications CIS documents required by the ACMA. Read the ENTIRE document carefully before answering.';

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
      description: 'The notice period required to cancel the service. Check sections about cancellation, termination, or how to end the service. Examples: "30 days written notice", "14 days", "30 days", "None". Australian ISPs commonly require 30 days notice. Only return "Not specified" if you have thoroughly checked the entire document and found no mention of notice period anywhere.',
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

async function firecrawlScrape(
  apiKey: string,
  url: string,
  prompt: string,
  schema: Record<string, unknown>
): Promise<any | null> {
  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['extract'],
        extract: { prompt, schema },
      }),
    });
    if (!res.ok) {
      console.log(`[terms-sync] Firecrawl ${res.status} for ${url}`);
      return null;
    }
    const data: any = await res.json();
    return data?.data?.extract ?? null;
  } catch (e) {
    console.log(`[terms-sync] Firecrawl failed for ${url}:`, e);
    return null;
  }
}

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
  } catch {}
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

/**
 * Extract terms from a single CIS URL.
 * Handles PDFs directly and HTML pages by first finding the PDF link.
 */
async function extractTermsFromCIS(
  cisUrl: string,
  apiKey: string
): Promise<(Omit<TermsEntry, 'extractedAt'>) | null> {
  const contentType = await resolveContentType(cisUrl);
  let targetUrl = cisUrl;

  if (contentType === 'html') {
    console.log(`[terms-sync] ${cisUrl} is HTML, searching for PDF link...`);
    const extracted = await firecrawlScrape(apiKey, cisUrl, CIS_PDF_LINK_PROMPT, CIS_PDF_LINK_SCHEMA);
    if (!extracted?.pdfUrl) {
      console.log(`[terms-sync] Could not find PDF link on ${cisUrl}`);
      return null;
    }
    targetUrl = extracted.pdfUrl;
    console.log(`[terms-sync] Found PDF: ${targetUrl}`);
  }

  const terms = await firecrawlScrape(apiKey, targetUrl, CIS_EXTRACT_PROMPT, CIS_EXTRACT_SCHEMA);
  if (!terms) return null;

  return {
    minimumTerm: terms.minimumTerm || null,
    cancellationFees: terms.cancellationFees || null,
    noticePeriod: terms.noticePeriod || null,
    typicalEveningSpeed: parseEveningSpeed(terms.typicalEveningSpeed),
    resolvedUrl: targetUrl !== cisUrl ? targetUrl : undefined,
  };
}

/**
 * After extracting terms for a URL, merge into terms.json and plan JSONs in R2.
 */
async function mergeTermsIntoR2(
  bucket: R2Bucket,
  cisUrl: string,
  entry: TermsEntry
): Promise<void> {
  // Update terms.json
  let terms: Record<string, TermsEntry> = {};
  try {
    const existing = await bucket.get('data/terms/terms.json');
    if (existing) terms = await existing.json();
  } catch {}

  terms[cisUrl] = entry;

  await bucket.put('data/terms/terms.json', JSON.stringify(terms), {
    httpMetadata: { contentType: 'application/json' },
  });

  // Merge into plan JSONs that reference this CIS URL
  for (const speed of SPEED_TIERS) {
    try {
      const obj = await bucket.get(`data/plans/nbn-${speed}.json`);
      if (!obj) continue;
      const tierData: TierData = await obj.json();

      let changed = false;
      for (const plan of tierData.plans) {
        if (plan.cisUrl === cisUrl) {
          plan.minimumTerm = entry.minimumTerm;
          plan.cancellationFees = entry.cancellationFees;
          plan.noticePeriod = entry.noticePeriod;
          if (plan.typicalEveningSpeed == null && entry.typicalEveningSpeed != null) {
            plan.typicalEveningSpeed = entry.typicalEveningSpeed;
          }
          changed = true;
        }
      }

      if (changed) {
        await bucket.put(`data/plans/nbn-${speed}.json`, JSON.stringify(tierData), {
          httpMetadata: { contentType: 'application/json' },
        });
      }
    } catch {}
  }
}

/**
 * Collect all stale CIS URLs and enqueue them for extraction.
 */
async function enqueueStaleUrls(env: Env): Promise<{ enqueued: number; skipped: number }> {
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

  // Enqueue in batches (Queue.send supports individual messages)
  for (const url of staleUrls) {
    await env.TERMS_QUEUE.send({ cisUrl: url });
  }

  console.log(`[terms-sync] Enqueued ${staleUrls.length}, skipped ${skipped} fresh`);
  return { enqueued: staleUrls.length, skipped };
}

export default {
  // Cron trigger: enqueue all stale CIS URLs
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log('[terms-sync] Cron triggered, enqueuing stale URLs...');
    const { enqueued, skipped } = await enqueueStaleUrls(env);

    // Update meta
    if (enqueued > 0) {
      let meta: any = {};
      try {
        const m = await env.DATA_BUCKET.get('data/meta.json');
        if (m) meta = await m.json();
      } catch {}
      meta.lastTermsSync = new Date().toISOString();
      await env.DATA_BUCKET.put('data/meta.json', JSON.stringify(meta), {
        httpMetadata: { contentType: 'application/json' },
      });
    }
    console.log('[terms-sync] Enqueue complete');
  },

  // Queue consumer: process one CIS URL at a time
  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const { cisUrl } = msg.body;
      console.log(`[terms-sync] Processing: ${cisUrl}`);

      try {
        const result = await extractTermsFromCIS(cisUrl, env.FIRECRAWL_API_KEY);
        if (result) {
          const entry: TermsEntry = { ...result, extractedAt: new Date().toISOString() };
          await mergeTermsIntoR2(env.DATA_BUCKET, cisUrl, entry);
          console.log(`[terms-sync] Extracted and merged: ${cisUrl}`);
        } else {
          console.log(`[terms-sync] No terms extracted for: ${cisUrl}`);
        }
        msg.ack();
      } catch (err) {
        console.error(`[terms-sync] Failed for ${cisUrl}:`, err);
        msg.retry();
      }
    }
  },

  // HTTP trigger: enqueue + status
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

    const { enqueued, skipped } = await enqueueStaleUrls(env);
    return new Response(
      JSON.stringify({ triggered: true, enqueued, skipped }),
      { status: 202, headers: { 'Content-Type': 'application/json' } }
    );
  },
} satisfies ExportedHandler<Env>;
