/**
 * Provider links and referral programs.
 *
 * Rankings never depend on anything in this file. It only decides where the
 * "Go to provider" button points. When a provider has an approved referral
 * program, put the tracking URL in `referral` and the button is labelled as a
 * referral link; every other provider gets a plain link to its site.
 *
 * Referral networks used by Australian ISPs (apply first, then fill in):
 *   Commission Factory: Superloop, Exetel, Tangerine, Dodo, iPrimus, Southern Phone, Moose
 *   Impact:             Aussie Broadband, Belong, Kogan, Optus
 *   Rakuten / Partnerize: Telstra, TPG, iiNet, Internode
 *   Direct:             Leaptel, Launtel, Mate, Flip, Spintel (ask via their contact page)
 */
export interface ProviderLink {
  /** Provider names (case-insensitive) that map to this entry */
  match: string[];
  /** Plain website URL used when there is no referral URL */
  site: string;
  /** Approved referral / affiliate tracking URL. Leave null until approved. */
  referral: string | null;
  /** Human label for the FAQ / disclosure, e.g. "Commission Factory" */
  network?: string;
}

export const PROVIDER_LINKS: ProviderLink[] = [
  { match: ['superloop'], site: 'https://www.superloop.com/nbn', referral: null, network: 'Commission Factory' },
  { match: ['aussie broadband'], site: 'https://www.aussiebroadband.com.au/nbn/', referral: null, network: 'Impact' },
  { match: ['exetel'], site: 'https://www.exetel.com.au/nbn', referral: null, network: 'Commission Factory' },
  { match: ['tangerine telecom', 'tangerine'], site: 'https://www.tangerinetelecom.com.au/nbn-plans', referral: null, network: 'Commission Factory' },
  { match: ['leaptel'], site: 'https://leaptel.com.au/plans/', referral: null },
  { match: ['dodo'], site: 'https://www.dodo.com/nbn', referral: null, network: 'Commission Factory' },
  { match: ['iinet'], site: 'https://www.iinet.net.au/nbn/', referral: null, network: 'Rakuten' },
  { match: ['tpg'], site: 'https://www.tpg.com.au/nbn', referral: null, network: 'Rakuten' },
  { match: ['telstra'], site: 'https://www.telstra.com.au/internet/nbn', referral: null, network: 'Rakuten' },
  { match: ['optus'], site: 'https://www.optus.com.au/broadband-nbn', referral: null, network: 'Impact' },
  { match: ['vodafone'], site: 'https://www.vodafone.com.au/home-internet', referral: null },
  { match: ['kogan'], site: 'https://www.koganinternet.com.au/', referral: null, network: 'Impact' },
  { match: ['spintel'], site: 'https://www.spintel.net.au/nbn', referral: null },
  { match: ['flip'], site: 'https://flipconnect.com.au/nbn/', referral: null },
  { match: ['moose mobile', 'moose'], site: 'https://www.moosemobile.com.au/nbn/', referral: null, network: 'Commission Factory' },
  { match: ['amaysim'], site: 'https://www.amaysim.com.au/nbn', referral: null },
  { match: ['origin broadband', 'origin energy', 'origin'], site: 'https://www.originenergy.com.au/internet/plans/', referral: null },
  { match: ['swoop'], site: 'https://swoop.com.au/nbn/', referral: null },
  { match: ['southern phone'], site: 'https://www.southernphone.com.au/nbn', referral: null, network: 'Commission Factory' },
  { match: ['mate'], site: 'https://www.letsbemates.com.au/nbn/', referral: null },
  { match: ['launtel'], site: 'https://launtel.net.au/', referral: null },
  { match: ['belong'], site: 'https://www.belong.com.au/internet', referral: null, network: 'Impact' },
  { match: ['internode'], site: 'https://www.internode.on.net/residential/nbn/', referral: null, network: 'Rakuten' },
  { match: ['buddy telco'], site: 'https://www.buddytelco.com.au/', referral: null },
  { match: ['carbon comms'], site: 'https://carboncomms.com.au/nbn/', referral: null },
  { match: ['pentanet'], site: 'https://pentanet.com.au/nbn', referral: null },
  { match: ['occom'], site: 'https://www.occom.com.au/', referral: null },
  { match: ['future broadband'], site: 'https://www.futurebroadband.com.au/', referral: null },
  { match: ['iprimus - 1300 fibre 1', 'iprimus'], site: 'https://www.iprimus.com.au/nbn', referral: null, network: 'Commission Factory' },
  { match: ['more'], site: 'https://www.more.com.au/nbn', referral: null },
  { match: ['skymesh'], site: 'https://www.skymesh.net.au/nbn/', referral: null },
  { match: ['harbour isp'], site: 'https://www.harbourisp.com.au/', referral: null },
  { match: ['goodtel'], site: 'https://goodtel.com.au/', referral: null },
  { match: ['agl telecommunications', 'agl'], site: 'https://www.agl.com.au/internet', referral: null },
];

export interface ResolvedProviderLink {
  url: string;
  isReferral: boolean;
  network?: string;
}

/** Resolve the outbound link for a plan: referral if approved, else config site, else the data's website. */
export function resolveProviderLink(providerName: string, providerWebsite?: string | null): ResolvedProviderLink | null {
  const name = providerName.toLowerCase().trim();
  const entry = PROVIDER_LINKS.find(l => l.match.includes(name));
  if (entry?.referral) return { url: entry.referral, isReferral: true, network: entry.network };
  if (entry) return { url: entry.site, isReferral: false };
  if (providerWebsite) {
    const url = /^https?:\/\//i.test(providerWebsite) ? providerWebsite : `https://${providerWebsite}`;
    return { url, isReferral: false };
  }
  return null;
}

/** Providers currently earning a referral, for the disclosure text. */
export function referralProviders(): string[] {
  return PROVIDER_LINKS.filter(l => l.referral).map(l => l.match[0]);
}

export function slugifyProvider(name: string): string {
  return name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Turn ALL CAPS data names into something readable, keeping known acronyms. */
const ACRONYMS: Record<string, string> = {
  tpg: 'TPG', iinet: 'iiNet', agl: 'AGL', isp: 'ISP', ip: 'IP', it: 'IT', url: 'URL', iig: 'IIG', ehw: 'EHW', mocs: 'MOCS',
  nbn: 'NBN', tas: 'Tas', wa: 'WA', nsw: 'NSW', vic: 'VIC', qld: 'QLD', sa: 'SA', ozot: 'OZOT', cmobile: 'CMobile', mphone: 'MPhone',
};
export function displayProviderName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .split(/(\s+|-|\/)/)
    .map(part => {
      const key = part.replace(/[^a-z0-9.']/g, '');
      if (ACRONYMS[key]) return part.replace(key, ACRONYMS[key]);
      return part.replace(/(^|['.])([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase());
    })
    .join('');
}
