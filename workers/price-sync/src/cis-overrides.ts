/**
 * CIS URL overrides — applied after fetching from NetBargains.
 *
 * Key by provider name (case-insensitive match).
 * If a provider has a `cisUrl`, it replaces the NetBargains URL for ALL plans from that provider.
 * If a provider has a `planOverrides` map, it replaces the URL only for matching plan names.
 */

interface CisOverride {
  /** Replace CIS URL for all plans from this provider */
  cisUrl?: string;
  /** Replace CIS URL for specific plan names (case-insensitive match) */
  planOverrides?: Record<string, string>;
}

export const CIS_OVERRIDES: Record<string, CisOverride> = {
  'Origin Broadband': {
    cisUrl: 'https://www.originenergy.com.au/internet/terms-conditions/critical-information-summary/',
  },
  // Add more overrides as needed:
  // 'Provider Name': {
  //   cisUrl: 'https://...',  // applies to all plans
  // },
  // 'Another Provider': {
  //   planOverrides: {
  //     'Plan Name': 'https://...',  // applies to specific plan only
  //   },
  // },
};

export function applyCisOverrides<T extends { providerName: string; planName: string; cisUrl: string }>(
  plans: T[]
): T[] {
  const overridesByProvider = new Map<string, CisOverride>();
  for (const [name, override] of Object.entries(CIS_OVERRIDES)) {
    overridesByProvider.set(name.toLowerCase(), override);
  }

  return plans.map((plan) => {
    const override = overridesByProvider.get(plan.providerName.toLowerCase());
    if (!override) return plan;

    // Check plan-specific override first
    if (override.planOverrides) {
      const planKey = Object.keys(override.planOverrides).find(
        (k) => k.toLowerCase() === plan.planName.toLowerCase()
      );
      if (planKey) {
        return { ...plan, cisUrl: override.planOverrides[planKey] };
      }
    }

    // Fall back to provider-wide override
    if (override.cisUrl) {
      return { ...plan, cisUrl: override.cisUrl };
    }

    return plan;
  });
}
