import type { SpeedOption, SpeedOptionPlan } from '../lib/types';
import { calculateCooked } from '../lib/cooked';

interface Props {
  options: SpeedOption[];
  /** Speeds of the user's plan. upload is unknown when the plan was saved for a whole download tier. */
  yours: { download: number; upload?: number };
  userPrice: number;
  /** Commitment period in months */
  horizon: number;
}

interface Best extends SpeedOptionPlan {
  option: SpeedOption;
}

/** Cheapest of the effective price over the period and the plain monthly price, matching the main verdict */
function bestAt(options: SpeedOption[], horizon: number): Best | null {
  let best: Best | null = null;
  for (const option of options) {
    for (const candidate of [option.effective[horizon], option.monthly]) {
      if (candidate && (!best || candidate.cost < best.cost)) best = { ...candidate, option };
    }
  }
  return best;
}

function periodLabel(horizon: number): string {
  return horizon === 12 ? '1 year' : horizon === 24 ? '2 years' : `${horizon} months`;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function Row({ title, chip, chipColor, children }: { title: string; chip: string; chipColor?: string; children: preact.ComponentChildren }) {
  return (
    <details class="group bg-surface border border-surface-border rounded-xl">
      <summary class="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer list-none text-sm text-neutral-300 hover:text-white">
        <span>{title}</span>
        <span class="flex items-center gap-2 whitespace-nowrap">
          <span class="font-bold" style={{ color: chipColor }}>{chip}</span>
          <span class="text-neutral-500 transition-transform group-open:rotate-90">▸</span>
        </span>
      </summary>
      <div class="px-4 pb-4 pt-1 text-sm text-neutral-400 space-y-1">{children}</div>
    </details>
  );
}

function planLine(best: Best, horizon: number) {
  const { option } = best;
  return (
    <p>
      The cheapest over {periodLabel(horizon)} is <span class="text-white">{money(best.cost)}/mo</span> ({best.provider}
      {', '}{option.download}/{option.upload}).
      {best.cost < option.monthly.cost - 0.005 ? ` That averages in intro discounts. The cheapest list price is ${money(option.monthly.cost)}/mo.` : ''}{' '}
      <a href={`/${option.key}`} class="underline hover:text-white">See these plans</a>
    </p>
  );
}

export default function SpeedComparisons({ options, yours, userPrice, horizon }: Props) {
  const upOk = (o: SpeedOption) => yours.upload === undefined || o.upload >= yours.upload;
  const upLow = (o: SpeedOption) => yours.upload !== undefined && o.upload <= yours.upload;

  // Only faster plans are compared here (your exact speed is the main verdict), and only plans that are
  // as good or better on both speeds count against you.
  const fasterUpload = yours.upload === undefined ? null : bestAt(
    options.filter(o => o.download === yours.download && o.upload > yours.upload!),
    horizon
  );
  const fasterDownload = bestAt(options.filter(o => o.download > yours.download && upOk(o)), horizon);
  // Slower plans never lower the rating, they are shown as a trade off.
  const slower = yours.upload === undefined ? null : bestAt(
    options.filter(o => o.download <= yours.download && upLow(o) && !(o.download === yours.download && o.upload === yours.upload)),
    horizon
  );

  if (!fasterUpload && !fasterDownload && !slower) return null;

  const yourSpeed = yours.upload === undefined ? `${yours.download} Mbps` : `${yours.download}/${yours.upload}`;

  function rated(best: Best | null, title: string, scope: string) {
    if (!best) return null;
    const r = calculateCooked(userPrice, best.cost);
    const diff = userPrice - best.cost;
    return (
      <Row title={title} chip={r.label} chipColor={r.color}>
        <p>Compared with plans with {scope}.</p>
        {planLine(best, horizon)}
        <p>
          {diff > 0.005
            ? <>You pay {money(userPrice)}, so a faster plan could save you <span class="text-white">{money(diff)}/mo</span>.</>
            : diff < -0.005
              ? <>You pay {money(userPrice)}, which is <span class="text-white">{money(-diff)}/mo less</span> than the cheapest faster plan.</>
              : <>You pay {money(userPrice)}, the same as the cheapest faster plan.</>}
        </p>
      </Row>
    );
  }

  const slowerSave = slower ? userPrice - slower.cost : 0;

  return (
    <div class="space-y-2">
      <div class="text-sm text-neutral-400 px-1">More ways to compare your {yourSpeed} plan</div>
      {rated(
        fasterUpload,
        `How does your plan compare to faster upload speeds in the ${yours.download} Mbps tier?`,
        `${yours.download} Mbps download and a faster upload speed (more than ${yours.upload} Mbps)`
      )}
      {rated(
        fasterDownload,
        'How does your plan compare to faster download speeds?',
        `a faster download speed (more than ${yours.download} Mbps)${yours.upload === undefined ? '' : ` and ${yours.upload} Mbps upload or faster`}`
      )}
      {slower && (
        <Row
          title="What if you accept slower speeds?"
          chip={slowerSave > 0.005 ? `Save up to ${money(slowerSave)}/mo` : 'Nothing cheaper'}
          chipColor={slowerSave > 0.005 ? '#4ade80' : undefined}
        >
          <p>This doesn't change your rating. It shows what a slower plan would cost.</p>
          {planLine(slower, horizon)}
          <p>
            {slowerSave > 0.005
              ? <>That's <span class="text-white">{money(slowerSave)}/mo</span> less than you pay now, for {slower.option.download} Mbps down and {slower.option.upload} Mbps up instead of {yours.download} and {yours.upload}.</>
              : <>No slower plan is cheaper than your {money(userPrice)}/mo.</>}
          </p>
        </Row>
      )}
    </div>
  );
}
