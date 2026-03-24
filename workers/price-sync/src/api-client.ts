import type { NetBargainsPlan, DownloadSpeed } from './types';

const API_BASE = 'https://api.netbargains.com.au/v1';
const PAGE_SIZE = 50;
const DELAY_MS = 500;
const USER_AGENT = 'ismynbncooked-bot/1.0';

interface NetBargainsResponse {
  items: NetBargainsPlan[];
  total: number;
  skip: number;
  limit: number;
  has_more: boolean;
}

async function fetchPage(
  apiKey: string,
  speed: DownloadSpeed,
  skip: number
): Promise<NetBargainsResponse> {
  const url = new URL(`${API_BASE}/plans/latest`);
  url.searchParams.set('speed', speed.toString());
  url.searchParams.set('connection_type', 'FIXED_LINE');
  url.searchParams.append('network_type', 'NBN');
  url.searchParams.append('network_type', 'OPTICOMM');
  url.searchParams.set('skip', skip.toString());
  url.searchParams.set('limit', PAGE_SIZE.toString());
  url.searchParams.set('sort_by', 'monthly_price');
  url.searchParams.set('sort_order', 'asc');

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  });

  if (!res.ok) {
    throw new Error(`NetBargains API error: ${res.status} ${await res.text()}`);
  }

  return await res.json() as NetBargainsResponse;
}

export async function fetchPlansForTier(
  apiKey: string,
  speed: DownloadSpeed
): Promise<NetBargainsPlan[]> {
  const allPlans: NetBargainsPlan[] = [];
  let skip = 0;
  let hasMore = true;
  let pageCount = 0;

  while (hasMore) {
    if (pageCount > 0) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }

    const response = await fetchPage(apiKey, speed, skip);
    allPlans.push(...response.items);

    hasMore = response.has_more;
    skip += PAGE_SIZE;
    pageCount++;

    console.log(`[price-sync] NBN ${speed} page ${pageCount}: ${response.items.length} plans (total: ${allPlans.length}/${response.total})`);
  }

  return allPlans;
}
