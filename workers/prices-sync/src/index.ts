interface Env {
  DATA_BUCKET: R2Bucket;
  FIRECRAWL_API_KEY?: string;
}

interface ComparisonUnit {
  label: string;
  icon: string;
  price: number;
  per: 'month' | 'total';
  note?: string;
  source?: string;
  sourceUrl?: string;
  state?: string;
}

interface ComparisonsData {
  updatedAt: string;
  units: Record<string, ComparisonUnit>;
}

type AUState = 'nsw' | 'vic' | 'qld' | 'sa' | 'wa' | 'tas' | 'act' | 'nt';

// Fallback prices — used when scraping fails
const FALLBACK = {
  petrol: 2.10,
  flatWhite: 5.50,
  avo: 3.50,
  netflix: 20.99,
  pt: {
    nsw: 4.80, vic: 5.30, qld: 4.96, sa: 4.45,
    wa: 4.90, tas: 3.60, act: 5.12, nt: 3.00,
  },
  // Median dwelling prices per state (capital city) — from PropTrack Home Price Index
  house2br: {
    nsw: 1255000, // Sydney
    vic: 854000,  // Melbourne
    qld: 1046000, // Brisbane
    sa: 929000,   // Adelaide
    wa: 987000,   // Perth
    tas: 718000,  // Hobart
    act: 874000,  // Canberra
    nt: 598000,   // Darwin
  },
};

const STATE_NAMES: Record<AUState, string> = {
  nsw: 'Sydney', vic: 'Melbourne', qld: 'Brisbane', sa: 'Adelaide',
  wa: 'Perth', tas: 'Hobart', act: 'Canberra', nt: 'Darwin',
};

// --- Firecrawl helper ---

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
      console.log(`[prices-sync] Firecrawl ${res.status} for ${url}`);
      return null;
    }
    const data: any = await res.json();
    return data?.data?.extract ?? null;
  } catch (e) {
    console.log(`[prices-sync] Firecrawl failed for ${url}:`, e);
    return null;
  }
}

// --- Helpers ---

/** Fetch with a timeout (default 10s) to prevent hanging on unresponsive hosts */
async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// --- Fetchers ---

async function fetchPetrolPrice(): Promise<number> {
  try {
    const res = await fetchWithTimeout(
      'https://www.fuelwatch.wa.gov.au/fuelwatch/fuelWatchRSS?Product=1&Region=25',
      { headers: { 'User-Agent': 'ismynbncooked-bot/1.0' } }
    );
    if (res.ok) {
      const xml = await res.text();
      const prices = [...xml.matchAll(/<price>([\d.]+)<\/price>/g)].map(m => parseFloat(m[1]));
      if (prices.length > 0) {
        const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
        return avg > 10 ? avg / 100 : avg;
      }
    }
  } catch (e) {
    console.log('[prices-sync] FuelWatch failed:', e);
  }
  return FALLBACK.petrol;
}

async function fetchAvoPrice(firecrawlKey?: string): Promise<number> {
  const url = 'https://www.woolworths.com.au/shop/productdetails/120080/hass-avocado';

  // Strategy 1: Direct fetch with JSON-LD extraction (free, ptrckr approach)
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    if (res.ok) {
      const html = await res.text();

      // pdp-schema tag (Woolworths specific)
      const pdpMatch = html.match(/<script[^>]*id="pdp-schema"[^>]*>([\s\S]*?)<\/script>/i);
      if (pdpMatch) {
        const jsonLd = JSON.parse(pdpMatch[1]);
        const offers = jsonLd?.offers ?? jsonLd?.[0]?.offers;
        const price = parseFloat(offers?.price ?? offers?.lowPrice);
        if (!isNaN(price) && price > 0.50 && price < 20) {
          console.log(`[prices-sync] Avo (pdp-schema): $${price}`);
          return price;
        }
      }

      // Generic JSON-LD fallback
      const jsonLdMatches = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
      for (const match of jsonLdMatches) {
        try {
          const data = JSON.parse(match[1]);
          const item = Array.isArray(data) ? data.find((d: any) => d['@type'] === 'Product') : data;
          if (item?.['@type'] === 'Product') {
            const price = parseFloat(item.offers?.price ?? item.offers?.lowPrice);
            if (!isNaN(price) && price > 0.50 && price < 20) {
              console.log(`[prices-sync] Avo (json-ld): $${price}`);
              return price;
            }
          }
        } catch { /* skip */ }
      }
    }
  } catch (e) {
    console.log('[prices-sync] Woolies direct failed:', e);
  }

  // Strategy 2: Firecrawl AI extraction (5 credits)
  if (firecrawlKey) {
    const extracted = await firecrawlScrape(firecrawlKey, url,
      'Extract the current price of this single avocado product. Focus on the price shown for buying ONE avocado, not multi-buy deals.',
      { type: 'object', properties: { price: { type: 'number', description: 'Current price in AUD for one avocado' } } }
    );
    if (extracted?.price && extracted.price > 0.50 && extracted.price < 20) {
      console.log(`[prices-sync] Avo (firecrawl): $${extracted.price}`);
      return extracted.price;
    }
  }

  return FALLBACK.avo;
}

async function fetchNetflixPrice(firecrawlKey?: string): Promise<number> {
  const url = 'https://help.netflix.com/en/node/24926';

  // Strategy 1: Firecrawl AI extraction from Netflix pricing page
  if (firecrawlKey) {
    const extracted = await firecrawlScrape(firecrawlKey, url,
      'Extract the Netflix Australia plan prices in AUD from this page. I need the "Standard" plan price (NOT "Standard with ads"). The page lists plans like "Standard with ads: AU$9.99/month", "Standard: AU$20.99/month", "Premium: AU$28.99/month". Return the Standard (without ads) price as a number.',
      {
        type: 'object',
        properties: {
          standardPrice: { type: 'number', description: 'Netflix Standard (without ads) plan monthly price in AUD, e.g. 20.99' },
        },
      }
    );
    if (extracted?.standardPrice && extracted.standardPrice >= 10 && extracted.standardPrice <= 40) {
      console.log(`[prices-sync] Netflix (firecrawl): $${extracted.standardPrice}`);
      return extracted.standardPrice;
    }
  }

  // Strategy 2: Direct scrape fallback
  try {
    const res = await fetchWithTimeout('https://www.netflix.com/au/signup/planform', {
      headers: { 'User-Agent': 'ismynbncooked-bot/1.0' },
    });
    if (res.ok) {
      const html = await res.text();
      const prices = [...html.matchAll(/\$(\d+\.?\d{0,2})/g)]
        .map(m => parseFloat(m[1]))
        .filter(p => p >= 10 && p <= 40);
      if (prices.length > 0) {
        prices.sort((a, b) => a - b);
        const median = prices[Math.floor(prices.length / 2)];
        console.log(`[prices-sync] Netflix (direct): $${median}`);
        return median;
      }
    }
  } catch (e) {
    console.log('[prices-sync] Netflix direct failed:', e);
  }

  return FALLBACK.netflix;
}

// PT fare fetchers — each tries to scrape the state transit website
async function fetchPtFare(state: AUState, firecrawlKey?: string): Promise<number> {
  const urls: Record<AUState, string> = {
    nsw: 'https://transportnsw.info/tickets-opal/opal/fares',
    vic: 'https://www.ptv.vic.gov.au/tickets/myki/myki-fares/',
    qld: 'https://translink.com.au/tickets-and-fares/fares-and-zones/current-fares',
    sa: 'https://www.adelaidemetro.com.au/tickets-and-fares/fares',
    wa: 'https://www.transperth.wa.gov.au/tickets-fares/fares',
    tas: 'https://www.metrotas.com.au/fares/',
    act: 'https://www.transport.act.gov.au/getting-around/fares',
    nt: 'https://nt.gov.au/driving/public-transport-cycling/public-bus-services/bus-fares',
  };

  const cardNames: Record<AUState, string> = {
    nsw: 'Opal', vic: 'Myki', qld: 'Go Card', sa: 'Metrocard',
    wa: 'SmartRider', tas: 'Greencard', act: 'MyWay', nt: 'Tap and Ride',
  };

  // Try direct scrape first
  try {
    const res = await fetchWithTimeout(urls[state], { headers: { 'User-Agent': 'ismynbncooked-bot/1.0' } });
    if (res.ok) {
      const html = await res.text();
      const prices = [...html.matchAll(/\$(\d+\.\d{2})/g)]
        .map(m => parseFloat(m[1]))
        .filter(p => p >= 2 && p <= 12);
      if (prices.length > 0) {
        prices.sort((a, b) => a - b);
        const median = prices[Math.floor(prices.length / 2)];
        console.log(`[prices-sync] PT ${state} (direct): $${median}`);
        return median;
      }
    }
  } catch (e) {
    console.log(`[prices-sync] PT ${state} direct failed:`, e);
  }

  // Firecrawl fallback
  if (firecrawlKey) {
    const prompt = state === 'vic'
      ? 'Extract the "Full fare" "2 hours" "myki Money" fare from the metropolitan fares table. This is the standard adult 2-hour myki Money fare for Melbourne trains/trams/buses.'
      : `Extract the standard adult single trip fare for ${cardNames[state]} public transport in ${STATE_NAMES[state]}. Get the most common/typical zone 1-2 or inner city fare.`;
    const extracted = await firecrawlScrape(firecrawlKey, urls[state],
      prompt,
      { type: 'object', properties: { fare: { type: 'number', description: 'Adult single trip fare in AUD' } } }
    );
    if (extracted?.fare && extracted.fare >= 1 && extracted.fare <= 15) {
      console.log(`[prices-sync] PT ${state} (firecrawl): $${extracted.fare}`);
      return extracted.fare;
    }
  }

  return FALLBACK.pt[state];
}

const HOUSE_PRICES_URL = 'https://www.proptrack.com.au/home-price-index/';

/**
 * Fetch all capital city median home prices in one Firecrawl call.
 * Uses PropTrack Home Price Index which has a JS-rendered table with all cities.
 * We use median unit price (not house) since we're comparing deposits.
 */
async function fetchAllHousePrices(firecrawlKey?: string): Promise<Record<AUState, number>> {
  const fallback = { ...FALLBACK.house2br };

  if (!firecrawlKey) return fallback;

  // PropTrack's table is JS-rendered, so Firecrawl (which renders JS) is the only option
  const extracted = await firecrawlScrape(
    firecrawlKey,
    HOUSE_PRICES_URL,
    'This page has a table showing median home prices for Australian capital cities from the PropTrack Home Price Index. Extract the median price for units/apartments (not houses) for each capital city: Sydney, Melbourne, Brisbane, Adelaide, Perth, Hobart, Canberra, Darwin. If unit prices aren\'t shown separately, use the combined/all dwellings median. Return prices as numbers without dollar signs or commas.',
    {
      type: 'object',
      properties: {
        sydney:    { type: 'number', description: 'Sydney median unit/dwelling price in AUD' },
        melbourne: { type: 'number', description: 'Melbourne median unit/dwelling price in AUD' },
        brisbane:  { type: 'number', description: 'Brisbane median unit/dwelling price in AUD' },
        adelaide:  { type: 'number', description: 'Adelaide median unit/dwelling price in AUD' },
        perth:     { type: 'number', description: 'Perth median unit/dwelling price in AUD' },
        hobart:    { type: 'number', description: 'Hobart median unit/dwelling price in AUD' },
        canberra:  { type: 'number', description: 'Canberra median unit/dwelling price in AUD' },
        darwin:    { type: 'number', description: 'Darwin median unit/dwelling price in AUD' },
      },
    }
  );

  if (extracted) {
    const mapping: Record<string, AUState> = {
      sydney: 'nsw', melbourne: 'vic', brisbane: 'qld', adelaide: 'sa',
      perth: 'wa', hobart: 'tas', canberra: 'act', darwin: 'nt',
    };
    for (const [city, state] of Object.entries(mapping)) {
      const price = extracted[city];
      if (typeof price === 'number' && price >= 200000 && price <= 3000000) {
        fallback[state] = price;
        console.log(`[prices-sync] House ${state} (proptrack): $${price}`);
      }
    }
  }

  return fallback;
}

// --- Main ---

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log('[prices-sync] Updating comparison unit prices...');

    const firecrawlKey = env.FIRECRAWL_API_KEY;
    const states: AUState[] = ['nsw', 'vic', 'qld', 'sa', 'wa', 'tas', 'act', 'nt'];

    // Fetch common prices in parallel
    const [petrolResult, avoResult, netflixResult] = await Promise.allSettled([
      fetchPetrolPrice(),
      fetchAvoPrice(firecrawlKey),
      fetchNetflixPrice(firecrawlKey),
    ]);

    const val = (r: PromiseSettledResult<number>, fb: number) =>
      r.status === 'fulfilled' ? r.value : fb;

    const petrol  = val(petrolResult, FALLBACK.petrol);
    const avo     = val(avoResult, FALLBACK.avo);
    const netflix = val(netflixResult, FALLBACK.netflix);

    console.log(`[prices-sync] Petrol: $${petrol.toFixed(2)}, Avo: $${avo.toFixed(2)}, Netflix: $${netflix.toFixed(2)}`);

    // Fetch house prices in one batch (single page has all cities)
    const housePrices = await fetchAllHousePrices(firecrawlKey);

    // Fetch per-state PT fares sequentially to avoid rate-limiting Firecrawl
    const ptPrices: Record<AUState, number> = {} as any;

    for (const state of states) {
      const ptResult = await fetchPtFare(state, firecrawlKey);
      ptPrices[state] = ptResult;

      // Brief delay between states to be polite to APIs
      await new Promise(r => setTimeout(r, 1000));
    }

    const ptLabels: Record<AUState, string> = {
      nsw: 'Opal Trips', vic: 'Myki Trips', qld: 'Go Card Trips', sa: 'Metrocard Trips',
      wa: 'SmartRider Trips', tas: 'Greencard Trips', act: 'MyWay Trips', nt: 'Tap and Ride Trips',
    };

    // Build units
    const units: Record<string, ComparisonUnit> = {
      flatWhite: { label: 'Flat Whites',      icon: '☕', price: 5.50,    per: 'month', source: 'Average Australian cafe price' },
      avo:       { label: 'Avocados',          icon: '🥑', price: avo,     per: 'month', source: 'Woolworths Hass Avocado', sourceUrl: 'https://www.woolworths.com.au/shop/productdetails/120080/hass-avocado' },
      bunnings:  { label: 'Bunnings Snags',    icon: '🌭', price: 3.50,    per: 'month', source: 'Bunnings weekend sausage sizzle' },
      petrol:    { label: 'Litres of Petrol',  icon: '⛽', price: petrol,  per: 'month', source: 'Average ULP price (FuelWatch)', sourceUrl: 'https://www.fuelwatch.wa.gov.au/' },
      netflix:   { label: 'Netflix Months',    icon: '📺', price: netflix, per: 'month', source: 'Netflix Australia Standard plan', sourceUrl: 'https://help.netflix.com/en/node/24926' },
    };

    const ptSources: Record<AUState, { label: string; url: string }> = {
      nsw: { label: 'Transport NSW Opal fares', url: 'https://transportnsw.info/tickets-opal/opal/fares' },
      vic: { label: 'Myki fares', url: 'https://transport.vic.gov.au/tickets-and-myki/fares/metropolitan-train-tram-and-bus-fares' },
      qld: { label: 'TransLink Go Card fares', url: 'https://translink.com.au/tickets-and-fares/fares-and-zones/current-fares' },
      sa:  { label: 'Adelaide Metro Metrocard fares', url: 'https://www.adelaidemetro.com.au/tickets-and-fares/fares' },
      wa:  { label: 'Transperth SmartRider fares', url: 'https://www.transperth.wa.gov.au/tickets-fares/fares' },
      tas: { label: 'Metro Tasmania Greencard fares', url: 'https://www.metrotas.com.au/fares/' },
      act: { label: 'Transport Canberra MyWay fares', url: 'https://www.transport.act.gov.au/getting-around/fares' },
      nt:  { label: 'NT Bus fares', url: 'https://nt.gov.au/driving/public-transport-cycling/public-bus-services/bus-fares' },
    };

    // Add per-state PT fares
    for (const state of states) {
      units[`pt_${state}`] = {
        label: ptLabels[state],
        icon: '🚂',
        price: ptPrices[state],
        per: 'month',
        state,
        source: `${ptSources[state].label} — adult single trip`,
        sourceUrl: ptSources[state].url,
      };
    }

    // Add per-state house deposit (5% of 2BR median)
    for (const state of states) {
      const deposit = Math.round(housePrices[state] * 0.05);
      units[`deposit_${state}`] = {
        label: 'Years to a 5% Deposit',
        icon: '🏠',
        price: deposit,
        per: 'total',
        state,
        note: `5% of $${Math.round(housePrices[state] / 1000)}k median dwelling in ${STATE_NAMES[state]}`,
        source: `PropTrack Home Price Index — ${STATE_NAMES[state]} median unit price`,
        sourceUrl: 'https://www.proptrack.com.au/home-price-index/',
      };
    }

    console.log('[prices-sync] PT fares:', Object.entries(ptPrices).map(([s, p]) => `${s}: $${p.toFixed(2)}`).join(', '));
    console.log('[prices-sync] House 2BR:', Object.entries(housePrices).map(([s, p]) => `${s}: $${Math.round(p / 1000)}k`).join(', '));

    const data: ComparisonsData = {
      updatedAt: new Date().toISOString(),
      units,
    };

    await env.DATA_BUCKET.put('data/comparisons.json', JSON.stringify(data), {
      httpMetadata: { contentType: 'application/json' },
    });

    let meta: any = {};
    try {
      const m = await env.DATA_BUCKET.get('data/meta.json');
      if (m) meta = await m.json();
    } catch {}
    meta.lastComparisonSync = new Date().toISOString();
    await env.DATA_BUCKET.put('data/meta.json', JSON.stringify(meta), {
      httpMetadata: { contentType: 'application/json' },
    });

    console.log('[prices-sync] Complete');
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/status') {
      try {
        const obj = await env.DATA_BUCKET.get('data/comparisons.json');
        const data = obj ? await obj.json() as ComparisonsData : null;
        return new Response(JSON.stringify({
          ok: true,
          updatedAt: data?.updatedAt ?? null,
          unitCount: data ? Object.keys(data.units).length : 0,
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
    return new Response('Prices sync triggered', { status: 202 });
  },
} satisfies ExportedHandler<Env>;
