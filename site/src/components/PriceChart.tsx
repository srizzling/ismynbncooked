import { useState, useMemo, useCallback, useRef } from 'preact/hooks';
import type { DailySummary } from '../lib/types';

interface Props {
  history: DailySummary[];
}

const CHART_HEIGHT = 200;
const CHART_PADDING = 40;

export default function PriceChart({ history }: Props) {
  const [metric, setMetric] = useState<'cheapestPrice' | 'averagePrice'>('cheapestPrice');
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const { points, minY, maxY, labels, dataPoints } = useMemo(() => {
    if (!history.length) return { points: '', minY: 0, maxY: 100, labels: [], dataPoints: [] };

    const values = history.map((d) => d[metric]);
    const min = Math.floor(Math.min(...values) - 5);
    const max = Math.ceil(Math.max(...values) + 5);
    const range = max - min || 1;

    const width = 600;
    const height = CHART_HEIGHT;
    const stepX = width / Math.max(history.length - 1, 1);

    const dp: { x: number; y: number; date: string; value: number }[] = [];
    const pts = history
      .map((d, i) => {
        const x = CHART_PADDING + i * stepX;
        const y = height - ((d[metric] - min) / range) * (height - CHART_PADDING);
        dp.push({ x, y, date: d.date, value: d[metric] });
        return `${x},${y}`;
      })
      .join(' ');

    // Pick ~5 date labels
    const labelInterval = Math.max(1, Math.floor(history.length / 5));
    const dateLabels = history
      .filter((_, i) => i % labelInterval === 0 || i === history.length - 1)
      .map((d) => ({
        x: CHART_PADDING + history.indexOf(d) * stepX,
        label: new Date(d.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }),
      }));

    return { points: pts, minY: min, maxY: max, labels: dateLabels, dataPoints: dp };
  }, [history, metric]);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      const svg = svgRef.current;
      if (!svg || !dataPoints.length) return;

      const rect = svg.getBoundingClientRect();
      const svgWidth = CHART_PADDING * 2 + 600;
      const scaleX = svgWidth / rect.width;
      const mouseX = (e.clientX - rect.left) * scaleX;

      // Find nearest data point
      let nearest = 0;
      let minDist = Infinity;
      for (let i = 0; i < dataPoints.length; i++) {
        const dist = Math.abs(dataPoints[i].x - mouseX);
        if (dist < minDist) {
          minDist = dist;
          nearest = i;
        }
      }
      setActiveIndex(nearest);
    },
    [dataPoints]
  );

  const handleMouseLeave = useCallback(() => {
    setActiveIndex(null);
  }, []);

  if (!history.length) {
    return (
      <div class="bg-surface-raised border border-surface-border rounded-2xl p-6 text-center text-neutral-500">
        No price history available yet
      </div>
    );
  }

  const width = 600 + CHART_PADDING * 2;
  const height = CHART_HEIGHT + CHART_PADDING;

  const activePoint = activeIndex != null ? dataPoints[activeIndex] : null;

  return (
    <div class="hidden sm:block bg-surface-raised border border-surface-border rounded-2xl p-6">
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

      <div class="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          class="w-full"
          preserveAspectRatio="xMidYMid meet"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
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

          {/* Hover crosshair + dot */}
          {activePoint && (
            <>
              <line
                x1={activePoint.x}
                y1={10}
                x2={activePoint.x}
                y2={CHART_HEIGHT - CHART_PADDING}
                stroke="#525252"
                stroke-width="1"
                stroke-dasharray="4 3"
              />
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                r="4.5"
                fill="#f97316"
                stroke="#1c1917"
                stroke-width="2"
              />
            </>
          )}

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

        {/* Tooltip */}
        {activePoint && (
          <div
            class="absolute pointer-events-none bg-surface border border-surface-border rounded-lg px-3 py-1.5 shadow-lg text-xs"
            style={{
              left: `${(activePoint.x / width) * 100}%`,
              top: `${(activePoint.y / height) * 100 - 12}%`,
              transform: 'translate(-50%, -100%)',
            }}
          >
            <div class="text-white font-medium tabular-nums">${activePoint.value.toFixed(2)}</div>
            <div class="text-neutral-400">
              {new Date(activePoint.date).toLocaleDateString('en-AU', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
