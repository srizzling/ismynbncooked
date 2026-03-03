import { useState, useEffect } from 'preact/hooks';
import { SPEED_TIERS, TIER_LABELS, AU_STATES, STATE_LABELS, type SpeedTier, type AUState, type UserPlan } from '../lib/types';
import { saveUserPlan, getUserPlans, saveUserState, getUserState } from '../lib/storage';

export default function PlanChecker() {
  const [speed, setSpeed] = useState<SpeedTier>(100);
  const [price, setPrice] = useState('');
  const [provider, setProvider] = useState('');
  const [state, setState] = useState<AUState>('nsw');
  const [hasExisting, setHasExisting] = useState(false);
  const [onPromo, setOnPromo] = useState(false);
  const [fullPrice, setFullPrice] = useState('');
  const [promoMonthsLeft, setPromoMonthsLeft] = useState('');

  useEffect(() => {
    const plans = getUserPlans();
    // Find the most recently saved plan to pre-populate the form
    const entries = Object.entries(plans).filter(([_, v]) => v) as [string, UserPlan][];
    if (entries.length > 0) {
      setHasExisting(true);
      // Pick the most recent plan
      entries.sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt));
      const [key, plan] = entries[0];
      // key is like "nbn100" — extract the speed number
      const tierSpeed = parseInt(key.replace('nbn', '')) as SpeedTier;
      if (SPEED_TIERS.includes(tierSpeed)) setSpeed(tierSpeed);
      setPrice(plan.price.toString());
      setProvider(plan.provider);
      if (plan.fullPrice && plan.promoMonthsLeft) {
        setOnPromo(true);
        setFullPrice(plan.fullPrice.toString());
        // Calculate remaining months since savedAt
        const monthsSinceSaved = Math.floor(
          (Date.now() - new Date(plan.savedAt).getTime()) / (30 * 24 * 60 * 60 * 1000)
        );
        const remaining = Math.max(0, plan.promoMonthsLeft - monthsSinceSaved);
        setPromoMonthsLeft(remaining.toString());
      }
    }
    const savedState = getUserState();
    if (savedState) setState(savedState);
  }, []);

  function handleSubmit(e: Event) {
    e.preventDefault();
    const p = parseFloat(price);
    if (isNaN(p) || p <= 0) return;

    const promoOpts = onPromo ? {
      fullPrice: parseFloat(fullPrice) || undefined,
      promoMonthsLeft: parseInt(promoMonthsLeft) || undefined,
    } : undefined;

    saveUserPlan(speed, p, provider, promoOpts);
    saveUserState(state);
    window.location.href = `/nbn-${speed}`;
  }

  return (
    <div class="bg-surface-raised border border-surface-border rounded-2xl p-6 sm:p-8">
      <h2 class="font-display font-bold text-2xl mb-1">
        {hasExisting ? 'Update your plan' : 'Enter your plan'}
      </h2>
      <p class="text-neutral-400 text-sm mb-6">
        {hasExisting
          ? 'Your details are saved below. Update them or check a different speed tier.'
          : "Tell us what you're paying and we'll tell you if you're cooked"}
      </p>

      <form onSubmit={handleSubmit} class="space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Speed tier */}
          <div>
            <label class="block text-sm text-neutral-400 mb-1">Speed tier</label>
            <select
              value={speed}
              onChange={(e) => setSpeed(parseInt((e.target as HTMLSelectElement).value) as SpeedTier)}
              class="w-full bg-surface border border-surface-border rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-accent appearance-none"
            >
              {SPEED_TIERS.map((s) => (
                <option key={s} value={s}>
                  {TIER_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          {/* Monthly price */}
          <div>
            <label class="block text-sm text-neutral-400 mb-1">Monthly price</label>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="$89.00"
              value={price}
              onInput={(e) => setPrice((e.target as HTMLInputElement).value)}
              required
              class="w-full bg-surface border border-surface-border rounded-lg px-3 py-2.5 text-white placeholder-neutral-500 focus:outline-none focus:border-accent"
            />
          </div>

          {/* Provider */}
          <div>
            <label class="block text-sm text-neutral-400 mb-1">Provider (optional)</label>
            <input
              type="text"
              placeholder="e.g. Telstra"
              value={provider}
              onInput={(e) => setProvider((e.target as HTMLInputElement).value)}
              class="w-full bg-surface border border-surface-border rounded-lg px-3 py-2.5 text-white placeholder-neutral-500 focus:outline-none focus:border-accent"
            />
          </div>

          {/* State */}
          <div>
            <label class="block text-sm text-neutral-400 mb-1">Your state</label>
            <select
              value={state}
              onChange={(e) => setState((e.target as HTMLSelectElement).value as AUState)}
              class="w-full bg-surface border border-surface-border rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-accent appearance-none"
            >
              {AU_STATES.map((s) => (
                <option key={s} value={s}>
                  {STATE_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Promo toggle */}
        <div>
          <label class="flex items-center gap-2 text-sm text-neutral-400 cursor-pointer">
            <input
              type="checkbox"
              checked={onPromo}
              onChange={() => setOnPromo(!onPromo)}
              class="accent-accent"
            />
            I'm on a promo/introductory rate
          </label>
        </div>

        {/* Promo details */}
        {onPromo && (
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-4 border-l-2 border-accent/30">
            <div>
              <label class="block text-sm text-neutral-400 mb-1">Price after promo ends</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="$99.00"
                value={fullPrice}
                onInput={(e) => setFullPrice((e.target as HTMLInputElement).value)}
                class="w-full bg-surface border border-surface-border rounded-lg px-3 py-2.5 text-white placeholder-neutral-500 focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label class="block text-sm text-neutral-400 mb-1">Months left on promo</label>
              <input
                type="number"
                step="1"
                min="0"
                max="36"
                placeholder="e.g. 4"
                value={promoMonthsLeft}
                onInput={(e) => setPromoMonthsLeft((e.target as HTMLInputElement).value)}
                class="w-full bg-surface border border-surface-border rounded-lg px-3 py-2.5 text-white placeholder-neutral-500 focus:outline-none focus:border-accent"
              />
            </div>
            {fullPrice && promoMonthsLeft && price && (
              <div class="sm:col-span-2 text-sm text-neutral-400 bg-surface border border-surface-border rounded-lg p-3">
                Paying <span class="text-white font-medium">${parseFloat(price).toFixed(2)}/mo</span> for{' '}
                <span class="text-white font-medium">{promoMonthsLeft} more months</span>, then{' '}
                <span class="text-white font-medium">${parseFloat(fullPrice).toFixed(2)}/mo</span> ongoing.
                {(() => {
                  const promoLeft = parseInt(promoMonthsLeft) || 0;
                  const promoP = parseFloat(price) || 0;
                  const fullP = parseFloat(fullPrice) || 0;
                  if (promoLeft > 0 && promoP > 0 && fullP > 0) {
                    const totalCost12 = promoLeft <= 12
                      ? promoLeft * promoP + (12 - promoLeft) * fullP
                      : 12 * promoP;
                    const effective12 = totalCost12 / 12;
                    return (
                      <span class="block mt-1">
                        Your effective monthly over 12 months: <span class="text-accent font-medium">${effective12.toFixed(2)}/mo</span>
                      </span>
                    );
                  }
                  return null;
                })()}
              </div>
            )}
          </div>
        )}

        <button
          type="submit"
          class="w-full sm:w-auto bg-accent hover:bg-accent/90 text-white font-display font-bold rounded-lg px-8 py-3 text-lg transition-colors"
        >
          Am I cooked?
        </button>
      </form>
    </div>
  );
}
