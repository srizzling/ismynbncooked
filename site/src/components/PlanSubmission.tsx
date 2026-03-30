import { useState } from 'preact/hooks';
import type { NetworkType } from '../lib/types';

const DOWNLOAD_SPEEDS = [25, 50, 100, 250, 500, 750, 1000, 2000];
const SUBMIT_URL = import.meta.env.PUBLIC_SUBMIT_URL || '/submit-plan';

export default function PlanSubmission() {
  const [providerName, setProviderName] = useState('');
  const [network, setNetwork] = useState<NetworkType>('nbn');
  const [downloadSpeed, setDownloadSpeed] = useState('');
  const [uploadSpeed, setUploadSpeed] = useState('');
  const [planUrl, setPlanUrl] = useState('');
  const [cisUrl, setCisUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [isDuplicate, setIsDuplicate] = useState(false);

  const inputClass = "w-full bg-surface border border-surface-border rounded-lg px-3 py-2.5 text-white placeholder-neutral-500 focus:outline-none focus:border-accent";
  const selectClass = "w-full bg-surface border border-surface-border rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-accent appearance-none";

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!planUrl.trim() || submitting) return;

    setSubmitting(true);
    setError('');
    setIsDuplicate(false);

    try {
      const res = await fetch(SUBMIT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planUrl: planUrl.trim(),
          cisUrl: cisUrl.trim() || undefined,
          provider: providerName.trim() || undefined,
          networkType: network,
          downloadSpeed: downloadSpeed || undefined,
          uploadSpeed: uploadSpeed || undefined,
          notes: notes.trim() || undefined,
        }),
      });

      const data = await res.json() as { ok: boolean; error?: string };

      if (!data.ok) {
        if (res.status === 409) {
          setIsDuplicate(true);
          setError(data.error || 'This plan has already been submitted.');
        } else {
          setError(data.error || 'Something went wrong. Please try again.');
        }
        return;
      }

      setSubmitted(true);
    } catch {
      setError('Failed to submit. Please try again later.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div class="bg-surface-raised border border-surface-border rounded-2xl p-6 sm:p-8 text-center">
        <div class="text-4xl mb-4">&#10003;</div>
        <h2 class="font-display font-bold text-2xl mb-2">Thanks for the submission!</h2>
        <p class="text-neutral-400 mb-6">
          We've received your plan submission and will review it shortly.
        </p>
        <button
          onClick={() => {
            setSubmitted(false);
            setIsDuplicate(false);
            setError('');
            setProviderName('');
            setDownloadSpeed('');
            setUploadSpeed('');
            setPlanUrl('');
            setCisUrl('');
            setNotes('');
          }}
          class="text-sm text-neutral-400 hover:text-white underline"
        >
          Submit another plan
        </button>
      </div>
    );
  }

  return (
    <div class="bg-surface-raised border border-surface-border rounded-2xl p-6 sm:p-8">
      <h2 class="font-display font-bold text-2xl mb-1">Submit a missing plan</h2>
      <p class="text-neutral-400 text-sm mb-6">
        Know of an NBN or Opticomm plan that's not listed? Fill in what you know below — only the plan link is required.
        If you're unsure about any field, leave it blank and we'll figure it out during review.
      </p>

      {error && isDuplicate ? (
        <div class="mb-4 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 text-sm text-amber-400">
          <p class="font-medium mb-1">Already submitted</p>
          <p>{error}</p>
        </div>
      ) : error ? (
        <div class="mb-4 bg-cooked-red/10 border border-cooked-red/30 rounded-lg px-4 py-3 text-sm text-cooked-red">
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} class="space-y-4">
        {/* Plan URL — the only required field */}
        <div>
          <label class="block text-sm text-neutral-400 mb-1">Link to the plan page *</label>
          <input
            type="url"
            placeholder="https://www.provider.com.au/nbn-plans"
            value={planUrl}
            onInput={(e) => setPlanUrl((e.target as HTMLInputElement).value)}
            required
            class={inputClass}
          />
        </div>

        {/* CIS URL */}
        <div>
          <label class="block text-sm text-neutral-400 mb-1">Link to the CIS (Critical Information Summary)</label>
          <input
            type="url"
            placeholder="https://www.provider.com.au/cis/nbn-100.pdf"
            value={cisUrl}
            onInput={(e) => setCisUrl((e.target as HTMLInputElement).value)}
            class={inputClass}
          />
          <p class="text-xs text-neutral-500 mt-1">
            Can't find it? No worries — leave it blank and we'll track it down.
          </p>
        </div>

        {/* Provider + Network */}
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm text-neutral-400 mb-1">Provider name</label>
            <input
              type="text"
              placeholder="e.g. Superloop, Launtel"
              value={providerName}
              onInput={(e) => setProviderName((e.target as HTMLInputElement).value)}
              class={inputClass}
            />
          </div>
          <div>
            <label class="block text-sm text-neutral-400 mb-2">Network type</label>
            <div class="flex gap-4 py-2">
              <label class="flex items-center gap-2 text-sm text-neutral-300 cursor-pointer">
                <input
                  type="radio"
                  name="network"
                  value="nbn"
                  checked={network === 'nbn'}
                  onChange={() => setNetwork('nbn')}
                  class="accent-accent"
                />
                NBN
              </label>
              <label class="flex items-center gap-2 text-sm text-neutral-300 cursor-pointer">
                <input
                  type="radio"
                  name="network"
                  value="opticomm"
                  checked={network === 'opticomm'}
                  onChange={() => setNetwork('opticomm')}
                  class="accent-accent"
                />
                Opticomm
              </label>
            </div>
          </div>
        </div>

        {/* Speed tier */}
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm text-neutral-400 mb-1">Download speed</label>
            <select
              value={downloadSpeed}
              onChange={(e) => setDownloadSpeed((e.target as HTMLSelectElement).value)}
              class={selectClass}
            >
              <option value="">Not sure</option>
              {DOWNLOAD_SPEEDS.map(d => (
                <option key={d} value={d}>{d} Mbps</option>
              ))}
            </select>
          </div>
          <div>
            <label class="block text-sm text-neutral-400 mb-1">Upload speed (Mbps)</label>
            <input
              type="number"
              min="1"
              step="1"
              placeholder="e.g. 20"
              value={uploadSpeed}
              onInput={(e) => setUploadSpeed((e.target as HTMLInputElement).value)}
              class={inputClass}
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label class="block text-sm text-neutral-400 mb-1">Notes (optional)</label>
          <textarea
            placeholder="Anything else — e.g. promo pricing, contract terms, etc."
            value={notes}
            onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
            rows={3}
            class={inputClass + " resize-y"}
          />
        </div>

        <div class="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <button
            type="submit"
            disabled={submitting}
            class={`w-full sm:w-auto font-display font-bold rounded-lg px-8 py-3 text-lg transition-colors ${
              submitting
                ? 'bg-neutral-600 text-neutral-400 cursor-not-allowed'
                : 'bg-accent hover:bg-accent/90 text-white'
            }`}
          >
            {submitting ? 'Submitting...' : 'Submit plan'}
          </button>
          <p class="text-xs text-neutral-500">
            No account required. We'll review your submission and add the plan.
          </p>
        </div>
      </form>
    </div>
  );
}
