import { useState, useMemo } from 'preact/hooks';
import type { DailySummary } from '../lib/types';

interface Props {
  history: DailySummary[];
}

const CHART_HEIGHT = 200;
const CHART_PADDING = 40;

export default function PriceChart({ history }: Props) {
  const [metric, setMetric] = useState<'cheapestPrice' | 'averagePrice'>('cheapestPrice');

  const { points, minY, maxY, labels } = useMemo(() => {
    if (!history.length) return { points: '', minY: 0, maxY: 100, labels: [] };

    const values = history.map((d) => d[metric]);
    const min = Math.floor(Math.min(...values) - 5);
    const max = Math.ceil(Math.max(...values) + 5);
    const range = max - min || 1;

    const width = 600;
    const height = CHART_HEIGHT;
    const stepX = width / Math.max(history.length - 1, 1);

    const pts = history
      .map((d, i) => {
        const x = CHART_PADDING + i * stepX;
        const y = height - ((d[metric] - min) / range) * (height - CHART_PADDING);
        return `${x},${y}`;
      })
      .join(' ');

    // Pick ~5 date labels
    const labelInterval = Math.max(1, Math.floor(history.length / 5));
    const dateLabels = history
      .filter((_, i) => i % labelInterval === 0 || i === history.length - 1)
      .map((d, idx, arr) => ({
        x: CHART_PADDING + history.indexOf(d) * stepX,
        label: new Date(d.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }),
      }));

    return { points: pts, minY: min, maxY: max, labels: dateLabels };
  }, [history, metric]);

  if (!history.length) {
    return (
      <div class="bg-surface-raised border border-surface-border rounded-2xl p-6 text-center text-neutral-500">
        No price history available yet
      </div>
    );
  }

  const width = 600 + CHART_PADDING * 2;
  const height = CHART_HEIGHT + CHART_PADDING;

  return (
    <div class="bg-surface-raised border border-surface-border rounded-2xl p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-display font-bold text-xl">Price History</h3>
        <div class="flex gap-2">
          <button
            onClick={() => setMetric('cheapestPrice')}
            class={`text-xs px-3 py-1 rounded-full transition-colors ${
              metric === 'cheapestPrice'
                ? 'bg-accent text-white'
                : 'bg-surface border border-surface-border text-neutral-400 hover:text-white'
            }`}
          >
            Cheapest
          </button>
          <button
            onClick={() => setMetric('averagePrice')}
            class={`text-xs px-3 py-1 rounded-full transition-colors ${
              metric === 'averagePrice'
                ? 'bg-accent text-white'
                : 'bg-surface border border-surface-border text-neutral-400 hover:text-white'
            }`}
          >
            Average
          </button>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} class="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Y-axis labels */}
        <text x={CHART_PADDING - 5} y={15} fill="#737373" font-size="11" text-anchor="end">
          ${maxY}
        </text>
        <text
          x={CHART_PADDING - 5}
          y={CHART_HEIGHT - CHART_PADDING + 5}
          fill="#737373"
          font-size="11"
          text-anchor="end"
        >
          ${minY}
        </text>

        {/* Grid lines */}
        <line
          x1={CHART_PADDING}
          y1={10}
          x2={width - CHART_PADDING}
          y2={10}
          stroke="#262626"
          stroke-dasharray="4"
        />
        <line
          x1={CHART_PADDING}
          y1={CHART_HEIGHT - CHART_PADDING}
          x2={width - CHART_PADDING}
          y2={CHART_HEIGHT - CHART_PADDING}
          stroke="#262626"
          stroke-dasharray="4"
        />

        {/* Price line */}
        <polyline
          points={points}
          fill="none"
          stroke="#f97316"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />

        {/* X-axis date labels */}
        {labels.map((l) => (
          <text
            key={l.label}
            x={l.x}
            y={CHART_HEIGHT + 5}
            fill="#737373"
            font-size="10"
            text-anchor="middle"
          >
            {l.label}
          </text>
        ))}
      </svg>
    </div>
  );
}
