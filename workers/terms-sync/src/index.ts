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

const SPEED_TIERS = [25, 50, 100, 250, 500, 750, 1000, 2000];
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Schema for extracting contract terms + speed from a CIS PDF
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

/**
 * Check if a URL points to a PDF or an HTML page
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

/**
 * Extract terms from a CIS URL. Handles both:
 * - Direct PDF links (extracts terms directly)
 * - HTML landing pages (finds the PDF link first, then extracts)
 */
async function extractTermsFromCIS(
  cisUrl: string,
  apiKey: string
): Promise<(Omit<TermsEntry, 'extractedAt'>) | null> {
  try {
    const contentType = await resolveContentType(cisUrl);
    let targetUrl = cisUrl;

    if (contentType === 'html') {
      // Landing page — find the actual NBN residential CIS PDF
      console.log(`[terms-sync] ${cisUrl} is HTML, searching for PDF link...`);
      const extracted = await firecrawlScrape(
        apiKey,
        cisUrl,
        'This is a page listing Critical Information Summary (CIS) PDF documents for an Australian internet provider. Find the URL of the NBN residential fixed-line CIS PDF. Look for links that mention "nbn", "residential", "CIS", "FTTP", "HFC", "FTTC", or "FTTN". Do NOT pick mobile SIM CIS or fixed wireless CIS.',
        CIS_PDF_LINK_SCHEMA
      );

      if (!extracted?.pdfUrl) {
        console.log(`[terms-sync] Could not find PDF link on ${cisUrl}`);
        return null;
      }

      targetUrl = extracted.pdfUrl;
      console.log(`[terms-sync] Found PDF: ${targetUrl}`);

      // Rate limit between the two Firecrawl calls
      await delay(2000);
    }

    // Extract terms + speed from the PDF
    const terms = await firecrawlScrape(
      apiKey,
      targetUrl,
      'Extract the key details from this Australian NBN internet Critical Information Summary (CIS) document. Focus on: 1) The minimum contract term or lock-in period, 2) Any early termination or cancellation fees, 3) The notice period required to cancel, 4) The typical evening download speed (also called "typical busy period download speed", measured 7pm-11pm). These are Australian telecommunications CIS documents required by the ACMA.',
      CIS_EXTRACT_SCHEMA
    );

    if (!terms) return null;

    // Parse evening speed — ensure it's a valid number
    let eveningSpeed: number | null = null;
    if (terms.typicalEveningSpeed != null) {
      const parsed = typeof terms.typicalEveningSpeed === 'number'
        ? terms.typicalEveningSpeed
        : parseFloat(String(terms.typicalEveningSpeed));
      if (!isNaN(parsed) && parsed > 0 && parsed <= 10000) {
        eveningSpeed = Math.round(parsed * 10) / 10;
      }
    }

    return {
      minimumTerm: terms.minimumTerm || null,
      cancellationFees: terms.cancellationFees || null,
      noticePeriod: terms.noticePeriod || null,
      typicalEveningSpeed: eveningSpeed,
      resolvedUrl: targetUrl !== cisUrl ? targetUrl : undefined,
    };
  } catch (err) {
    console.error(`[terms-sync] Failed for ${cisUrl}:`, err);
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext, maxUrls?: number): Promise<void> {
    console.log('[terms-sync] Starting terms extraction...');

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

    // Extract terms for URLs not yet processed or older than 30 days
    // Limit per run to avoid waitUntil() timeouts on HTTP triggers
    const limit = maxUrls ?? cisUrls.size; // No limit on cron, limited on HTTP
    const now = Date.now();
    let extracted = 0;
    let skipped = 0;

    for (const url of cisUrls) {
      if (extracted >= limit) break;

      const existing = terms[url];
      if (existing && now - new Date(existing.extractedAt).getTime() < THIRTY_DAYS_MS) {
        skipped++;
        continue;
      }

      console.log(`[terms-sync] Extracting: ${url}`);
      const result = await extractTermsFromCIS(url, env.FIRECRAWL_API_KEY);

      if (result) {
        terms[url] = { ...result, extractedAt: new Date().toISOString() };
        extracted++;
      }

      // Rate limit: 2 seconds between CIS URLs
      await delay(2000);
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

    // Limit to 5 URLs per HTTP trigger to stay within waitUntil() time limits
    ctx.waitUntil(this.scheduled({} as ScheduledEvent, env, ctx, 5));
    return new Response('Terms sync triggered (batch of 5)', { status: 202 });
  },
} satisfies ExportedHandler<Env>;
