import type { SpeedOption, SpeedOptionPlan } from '../lib/types';

export interface Yours {
  download: number;
  /** Unknown when the plan was saved for a whole download tier */
  upload?: number;
}

export interface Best extends SpeedOptionPlan {
  option: SpeedOption;
}

interface Props {
  options: SpeedOption[];
  yours: Yours;
  userPrice: number;
  /** Commitment period in months */
  horizon: number;
}

/** Cheapest of the effective price over the period and the plain monthly price, matching the headline verdict */
function bestAt(options: SpeedOption[], horizon: number): Best | null {
  let best: Best | null = null;
  for (const option of options) {
    for (const candidate of [option.effective[horizon], option.monthly]) {
      if (candidate && (!best || candidate.cost < best.cost)) best = { ...candidate, option };
    }
  }
  return best;
}

/**
 * What the headline verdict compares the saved plan with: plans that are as good or better on both speeds
 * (your own tier included). Slower, cheaper plans never count against you. `exact` is the same comparison
 * restricted to exactly your speed.
 */
export function verdictBasis(options: SpeedOption[], yours: Yours, horizon: number): {
  baseline: Best | null;
  exact: Best | null;
  /** Cheapest plain monthly price among the plans being compared with */
  listMin: number | null;
} {
  const cohort = options.filter(o => o.download >= yours.download && (yours.upload === undefined || o.upload >= yours.upload));
  const exact = options.filter(o => o.download === yours.download && (yours.upload === undefined || o.upload === yours.upload));
  return {
    baseline: bestAt(cohort, horizon),
    exact: bestAt(exact, horizon),
    listMin: cohort.length > 0 ? Math.min(...cohort.map(o => o.monthly.cost)) : null,
  };
}

/** Plain words for what an averaged intro price really means, with what the plan costs afterwards. */
export function introNote(best: Best): string {
  if (best.promoMonths && best.listPrice && best.listPrice > best.cost + 0.005) {
    return ` This averages in a ${best.promoMonths} month intro discount. After that the plan costs ${money(best.listPrice)}/mo.`;
  }
  return best.cost < best.option.monthly.cost - 0.005
    ? ` This averages in intro discounts. The cheapest list price is ${money(best.option.monthly.cost)}/mo.`
    : '';
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
      {introNote(best)}{' '}
      <a href={`/${option.key}`} class="underline hover:text-white">See these plans</a>
    </p>
  );
}

export default function SpeedComparisons({ options, yours, userPrice, horizon }: Props) {
  const upOk = (o: SpeedOption) => yours.upload === undefined || o.upload >= yours.upload;
  const upLow = (o: SpeedOption) => yours.upload !== undefined && o.upload <= yours.upload;

  const { exact } = verdictBasis(options, yours, horizon);
  const fasterUpload = yours.upload === undefined ? null : bestAt(
    options.filter(o => o.download === yours.download && o.upload > yours.upload!),
    horizon
  );
  const fasterDownload = bestAt(options.filter(o => o.download > yours.download && upOk(o)), horizon);
  const slower = yours.upload === undefined ? null : bestAt(
    options.filter(o => o.download <= yours.download && upLow(o) && !(o.download === yours.download && o.upload === yours.upload)),
    horizon
  );

  if (!exact && !fasterUpload && !fasterDownload && !slower) return null;

  const yourSpeed = yours.upload === undefined ? `${yours.download} Mbps` : `${yours.download}/${yours.upload}`;

  function row(best: Best | null, title: string, who: string) {
    if (!best) return null;
    const diff = userPrice - best.cost;
    return (
      <Row
        title={title}
        chip={diff > 0.005 ? `Save ${money(diff)}/mo` : diff < -0.005 ? `You're ${money(-diff)}/mo cheaper` : 'Same price'}
        chipColor={diff > 0.005 ? '#4ade80' : undefined}
      >
        {planLine(best, horizon)}
        <p>
          {diff > 0.005
            ? <>You pay {money(userPrice)}, so {who} could save you <span class="text-white">{money(diff)}/mo</span>.</>
            : diff < -0.005
              ? <>You pay {money(userPrice)}, which is <span class="text-white">{money(-diff)}/mo less</span> than {who}.</>
              : <>You pay {money(userPrice)}, the same as {who}.</>}
        </p>
      </Row>
    );
  }

  const slowerSave = slower ? userPrice - slower.cost : 0;

  return (
    <div class="space-y-2">
      <div class="px-1">
        <div class="text-sm text-neutral-400">The same comparison, one speed at a time, for your {yourSpeed} plan</div>
        <div class="text-xs text-neutral-500 mt-0.5">Upload speed is how fast you send things, like video calls and backups. Download speed is what most people mean by internet speed.</div>
      </div>
      {row(exact, `At exactly your speed (${yourSpeed})`, 'the cheapest plan at your speed')}
      {row(fasterUpload, `With a higher upload speed (same ${yours.download} Mbps download)`, 'a plan with a higher upload speed')}
      {row(fasterDownload, 'With a higher download speed', 'a plan with a higher download speed')}
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
