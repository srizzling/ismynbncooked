import { useState } from 'preact/hooks';
import { ALERTS_URL } from '../lib/site';

interface Props {
  tierKey: string;
  label: string;
  defaultPrice?: number;
  defaultProvider?: string;
  /** YYYY-MM-DD */
  defaultPromoEndsAt?: string;
}

/**
 * Email alert signup for one tier. Double opt-in is handled by the alerts worker.
 * Kept deliberately small: one email field, two optional fields, no tracking.
 */
export default function AlertSignup({ tierKey, label, defaultPrice, defaultProvider, defaultPromoEndsAt }: Props) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [price, setPrice] = useState(defaultPrice ? String(defaultPrice) : '');
  const [promoEndsAt, setPromoEndsAt] = useState(defaultPromoEndsAt ?? '');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  async function submit(e: Event) {
    e.preventDefault();
    setStatus('sending');
    setError('');
    try {
      const form = e.currentTarget as HTMLFormElement;
      const honeypot = (form.elements.namedItem('website') as HTMLInputElement | null)?.value ?? '';
      const res = await fetch(`${ALERTS_URL}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          tierKey,
          monthlyPrice: price ? Number(price) : undefined,
          promoEndsAt: promoEndsAt || undefined,
          provider: defaultProvider,
          website: honeypot,
        }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Something went wrong');
      setStatus('sent');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  if (status === 'sent') {
    return (
      <div class="bg-cooked-green/10 border border-cooked-green/30 rounded-xl px-4 py-3 text-sm text-neutral-200">
        Check your inbox for a confirmation link. We only email when your promo is about to end or a plan at least 5% cheaper shows up.
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        class="w-full text-left bg-surface-raised border border-surface-border rounded-xl px-4 py-3 text-sm text-neutral-300 hover:border-accent transition-colors"
      >
        <span class="text-white font-medium">Get an email when {label} gets cheaper</span>
        <span class="text-neutral-500"> or when your promo is about to end. No spam, one click to leave.</span>
      </button>
    );
  }

  return (
    <form onSubmit={submit} class="bg-surface-raised border border-surface-border rounded-xl px-4 py-4 text-sm space-y-3">
      <div class="text-white font-medium">Price alerts for {label}</div>
      <div class="grid sm:grid-cols-3 gap-3">
        <label class="block sm:col-span-1">
          <span class="text-xs text-neutral-500">Email</span>
          <input
            type="email"
            required
            value={email}
            onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)}
            placeholder="you@example.com"
            class="mt-1 w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white placeholder:text-neutral-600 focus:border-accent focus:outline-none"
          />
        </label>
        <label class="block">
          <span class="text-xs text-neutral-500">What you pay now ($/mo, optional)</span>
          <input
            type="number"
            min="1"
            max="1000"
            step="0.01"
            value={price}
            onInput={(e) => setPrice((e.currentTarget as HTMLInputElement).value)}
            placeholder="e.g. 89"
            class="mt-1 w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white placeholder:text-neutral-600 focus:border-accent focus:outline-none"
          />
        </label>
        <label class="block">
          <span class="text-xs text-neutral-500">Promo ends (optional)</span>
          <input
            type="date"
            value={promoEndsAt}
            onInput={(e) => setPromoEndsAt((e.currentTarget as HTMLInputElement).value)}
            class="mt-1 w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white focus:border-accent focus:outline-none"
          />
        </label>
      </div>
      {/* Honeypot: hidden from people, filled by bots */}
      <input type="text" name="website" tabIndex={-1} autocomplete="off" class="hidden" aria-hidden="true" />
      <div class="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={status === 'sending'}
          class="bg-accent text-black font-medium rounded-lg px-4 py-2 hover:bg-orange-400 disabled:opacity-60 transition-colors"
        >
          {status === 'sending' ? 'Sending…' : 'Send confirmation'}
        </button>
        <button type="button" onClick={() => setOpen(false)} class="text-neutral-500 hover:text-white">Cancel</button>
        {status === 'error' && <span class="text-cooked-red">{error}</span>}
      </div>
      <p class="text-xs text-neutral-600">
        Stored: your email, this tier and the two optional fields. Nothing else. Every email has an unsubscribe link.
        <a href="/privacy" class="underline hover:text-white ml-1">Privacy</a>
      </p>
    </form>
  );
}
