import type { APIRoute } from 'astro';
import satori from 'satori';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { decodeShareData, getLevelInfo } from '../../lib/share';
import { TIER_LABELS, SPEED_TIERS } from '../../lib/types';

let wasmInitialized = false;

async function loadGoogleFont(family: string, weight: number): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&display=swap`;
  const cssRes = await fetch(url);
  const css = await cssRes.text();
  const match = css.match(/src:\s*url\(([^)]+)\)/);
  if (!match?.[1]) throw new Error(`Could not find font URL for ${family}:${weight}`);
  const fontRes = await fetch(match[1]);
  return fontRes.arrayBuffer();
}

export const GET: APIRoute = async ({ url }) => {
  const encoded = url.searchParams.get('d');
  const data = encoded ? decodeShareData(encoded) : null;

  if (!data || !SPEED_TIERS.includes(data.s)) {
    return new Response('Missing or invalid share data', { status: 400 });
  }

  const levelInfo = getLevelInfo(data.l);
  const userPrice = data.p / 100;
  const cheapestEffective = data.c / 100;
  const provider = data.v;
  const tierLabel = TIER_LABELS[data.s];
  const horizon = data.h || 12;
  const horizonLabel = horizon === 12 ? '1yr' : horizon === 24 ? '2yr' : `${horizon}mo`;
  // Compute user effective price for promo scenarios
  const userFullPrice = data.fp ? data.fp / 100 : 0;
  const userPromoMonths = data.pd || 0;
  let userEffective = userPrice;
  if (userFullPrice > 0 && userPromoMonths > 0) {
    const promoMonths = Math.min(userPromoMonths, horizon);
    const fullMonths = horizon - promoMonths;
    userEffective = (promoMonths * userPrice + fullMonths * userFullPrice) / horizon;
  }

  const overpayPercent = cheapestEffective > 0
    ? ((userEffective - cheapestEffective) / cheapestEffective * 100).toFixed(0)
    : '0';
  const savings = Math.max(0, userEffective - cheapestEffective);

  const [fontBold, fontRegular] = await Promise.all([
    loadGoogleFont('Inter', 700),
    loadGoogleFont('Inter', 400),
  ]);

  const isWinning = data.l === 'winning';
  const isCooked = savings > 0;

  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          backgroundColor: '#0a0a0a',
          padding: '60px',
          fontFamily: 'Inter',
        },
        children: [
          // Top bar
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '20px',
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: { color: '#737373', fontSize: '24px' },
                    children: `${tierLabel} ${provider ? `with ${provider}` : ''}`,
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: { color: '#525252', fontSize: '20px' },
                    children: `Compared over ${horizonLabel}`,
                  },
                },
              ],
            },
          },
          // Main rating
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                flex: '1',
                gap: '16px',
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      fontSize: '28px',
                      color: '#a3a3a3',
                    },
                    children: "Someone's NBN plan is...",
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      fontSize: '72px',
                      fontWeight: 700,
                      color: levelInfo.color,
                      textAlign: 'center',
                    },
                    children: levelInfo.label,
                  },
                },
                // Price comparison
                isCooked
                  ? {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          gap: '40px',
                          marginTop: '20px',
                          alignItems: 'center',
                        },
                        children: [
                          {
                            type: 'div',
                            props: {
                              style: {
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                              },
                              children: [
                                {
                                  type: 'div',
                                  props: {
                                    style: { color: '#737373', fontSize: '20px' },
                                    children: 'Paying',
                                  },
                                },
                                {
                                  type: 'div',
                                  props: {
                                    style: { color: '#ffffff', fontSize: '48px', fontWeight: 700 },
                                    children: `$${userEffective.toFixed(0)}/mo`,
                                  },
                                },
                              ],
                            },
                          },
                          {
                            type: 'div',
                            props: {
                              style: { color: '#ef4444', fontSize: '36px', fontWeight: 700 },
                              children: `${overpayPercent}% more`,
                            },
                          },
                          {
                            type: 'div',
                            props: {
                              style: {
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                              },
                              children: [
                                {
                                  type: 'div',
                                  props: {
                                    style: { color: '#737373', fontSize: '20px' },
                                    children: 'Cheapest',
                                  },
                                },
                                {
                                  type: 'div',
                                  props: {
                                    style: { color: '#4ade80', fontSize: '48px', fontWeight: 700 },
                                    children: `$${cheapestEffective.toFixed(0)}/mo`,
                                  },
                                },
                              ],
                            },
                          },
                        ],
                      },
                    }
                  : isWinning
                    ? {
                        type: 'div',
                        props: {
                          style: {
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            marginTop: '20px',
                            gap: '8px',
                          },
                          children: [
                            {
                              type: 'div',
                              props: {
                                style: { color: '#22d3ee', fontSize: '32px', fontWeight: 700 },
                                children: `$${Math.abs(userEffective - cheapestEffective).toFixed(0)}/mo less than the cheapest plan`,
                              },
                            },
                          ],
                        },
                      }
                    : {
                        type: 'div',
                        props: {
                          style: { color: '#4ade80', fontSize: '28px', marginTop: '20px' },
                          children: 'On the cheapest plan. Sweet as.',
                        },
                      },
              ],
            },
          },
          // Footer
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderTop: '1px solid #262626',
                paddingTop: '20px',
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: { color: '#525252', fontSize: '22px' },
                    children: 'amigettingrorted.au',
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: { color: '#525252', fontSize: '22px' },
                    children: 'Check your own plan',
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: 'Inter', data: fontBold, weight: 700, style: 'normal' as const },
        { name: 'Inter', data: fontRegular, weight: 400, style: 'normal' as const },
      ],
    }
  );

  // Initialize resvg WASM if needed
  if (!wasmInitialized) {
    try {
      await initWasm(fetch('https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm'));
      wasmInitialized = true;
    } catch {
      // May already be initialized
      wasmInitialized = true;
    }
  }

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  return new Response(pngBuffer, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
};
