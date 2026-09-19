/** Site-wide configuration that isn't data. */

/** Where the "shout a coffee" link goes. Set to null to hide it. */
export const SUPPORT_URL: string | null = 'https://github.com/sponsors/srizzling';

/** Alerts worker base URL (subscribe / confirm / unsubscribe). */
export const ALERTS_URL: string =
  (import.meta.env.PUBLIC_ALERTS_URL as string | undefined) || 'https://ismynbncooked-alerts.venksriram.workers.dev';

export const GITHUB_URL = 'https://github.com/srizzling/ismynbncooked';

/** Google AdSense publisher ID. Used for the account verification tag and ads.txt. Ad units only render once slot IDs are set. */
export const ADSENSE_CLIENT: string = (import.meta.env.PUBLIC_ADSENSE_CLIENT as string | undefined) || 'ca-pub-4243429542189456';
