import { useState, useEffect } from 'preact/hooks';
import type { MetaData } from '../lib/types';
import { fetchMeta } from '../lib/data';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function DataFreshness() {
  const [meta, setMeta] = useState<MetaData | null>(null);

  useEffect(() => {
    fetchMeta().then(setMeta).catch(() => {});
  }, []);

  if (!meta) return null;

  return (
    <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
      {meta.lastPriceSync && (
        <span title={new Date(meta.lastPriceSync).toLocaleString()}>
          Plans: {timeAgo(meta.lastPriceSync)}
        </span>
      )}
      {meta.lastComparisonSync && (
        <span title={new Date(meta.lastComparisonSync).toLocaleString()}>
          Prices: {timeAgo(meta.lastComparisonSync)}
        </span>
      )}
    </div>
  );
}
