import OPT from './data/skater-options.json';

/**
 * The create-a-skater look. Every option id comes from
 * src/data/skater-options.json, which tools/riders/generate_custom.py also
 * reads to build the modular models in public/riders/custom_{m,f}.glb.
 */

export type Body = 'm' | 'f';

export interface CustomLook {
  body: Body;
  height: number; // 0 short .. 1 tall
  /** body shape sliders by ShapeDef id, 0 = the "lo" end, 0.5 = average, 1 = the "hi" end */
  shape: Record<string, number>;
  skin: string;
  hair: string | null;
  hairColor: string;
  hat: string | null;
  hatColor: string;
  top: string;
  topColor: string;
  bottom: string;
  bottomColor: string;
  shoes: string;
  shoesColor: string;
}

export interface Option {
  id: string;
  label: string;
  /** themed add-on part (beach, party, cowboy): lives in extras_<m|f>.glb, loaded on demand */
  theme?: string;
  /** the colour it starts in when picked (themed items look odd in the generic grey) */
  color?: string;
  /** only offered for this body */
  only?: Body;
}

export interface ShapeDef extends Option {
  lo: string;
  hi: string;
  /** scales the morph influence (1 when omitted) */
  strength?: number;
}

export const SHAPES: ShapeDef[] = OPT.shape;

const themed = (items: { id: string; label: string; theme: string; color: string }[]): Option[] => items.map(({ id, label, theme, color }) => ({ id, label, theme, color }));

export const HAIR: Option[] = OPT.hair;
export const HATS: Option[] = [...OPT.hats, ...themed(OPT.extras.hats)];
export const TOPS: Option[] = [...OPT.tops, ...themed(OPT.extras.tops)];
export const BOTTOMS: Option[] = [...OPT.bottoms, ...themed(OPT.extras.bottoms)];
export const SHOES: Option[] = [...OPT.shoes, ...themed(OPT.extras.shoes)];

/** options this body can wear */
export const forBody = (items: Option[], body: Body) => items.filter((o) => !o.only || o.only === body);

/** the node names a look wears that live in the on-demand extras model */
export function extraParts(look: CustomLook): string[] {
  const has = (list: Option[], id: string | null) => !!id && list.some((o) => o.id === id && o.theme);
  return [
    has(HATS, look.hat) ? 'hat_' + look.hat : '',
    has(TOPS, look.top) ? 'top_' + look.top : '',
    has(BOTTOMS, look.bottom) ? 'bottom_' + look.bottom : '',
    has(SHOES, look.shoes) ? 'shoes_' + look.shoes : '',
  ].filter(Boolean);
}

export const SKIN_TONES = ['#f6dcc7', '#ecc19c', '#d49c72', '#b87a50', '#8d5a3b', '#62402b', '#3f2a1d'];
export const HAIR_COLORS = ['#17120f', '#3a2619', '#6b4226', '#a5683a', '#d7b25f', '#ecdcae', '#b23a2a', '#8f6fb5', '#3f8fbd', '#e8e6e1', '#8b8b8b', '#e0709a'];
export const CLOTH_COLORS = ['#f4f1ea', '#1f1f1f', '#5b5b5b', '#c8402d', '#d97757', '#e3a83a', '#788c5d', '#3fa7a0', '#3a6fb0', '#2c3e64', '#7a56a8', '#d9779a', '#8a5a3a', '#c9b793'];

export const HEIGHT_MIN = 1.55;
export const HEIGHT_MAX = 1.95;
export const heightOf = (look: CustomLook) => HEIGHT_MIN + (HEIGHT_MAX - HEIGHT_MIN) * look.height;

export function defaultLook(): CustomLook {
  return {
    body: 'm',
    height: 0.5,
    shape: Object.fromEntries(SHAPES.map((d) => [d.id, 0.5])),
    skin: SKIN_TONES[2],
    hair: 'short02',
    hairColor: HAIR_COLORS[1],
    hat: null,
    hatColor: '#6b6a64',
    top: 'tee',
    topColor: '#d97757',
    bottom: 'jeans',
    bottomColor: '#4d6c9b',
    shoes: 'shoes06',
    shoesColor: '#f4f1ea',
  };
}

const HEX = /^#[0-9a-f]{6}$/i;

const unit = (v: unknown, fallback: number) => (typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);

/** morph target name -> influence for the body shape sliders (`weight-lo`, `weight-hi`, ...) */
export function shapeInfluences(look: CustomLook): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of SHAPES) {
    const v = look.shape[d.id] ?? 0.5;
    const k = d.strength ?? 1;
    out[d.id + '-lo'] = Math.max(0, 1 - v * 2) * k;
    out[d.id + '-hi'] = Math.max(0, v * 2 - 1) * k;
  }
  return out;
}

/** Anything from storage (or an older build) -> a look the models can actually dress. */
export function sanitizeLook(raw: unknown): CustomLook {
  const d = defaultLook();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const color = (k: keyof CustomLook) => (typeof r[k] === 'string' && HEX.test(r[k] as string) ? (r[k] as string) : (d[k] as string));
  const body: Body = r.body === 'f' ? 'f' : 'm';
  const pick = (k: keyof CustomLook, list: Option[]) => (typeof r[k] === 'string' && forBody(list, body).some((o) => o.id === r[k]) ? (r[k] as string) : (d[k] as string));
  const optional = (k: 'hair' | 'hat', list: Option[]) => (r[k] === null ? null : typeof r[k] === 'string' && list.some((o) => o.id === r[k]) ? (r[k] as string) : d[k]);
  return {
    body,
    height: unit(r.height, d.height),
    shape: Object.fromEntries(SHAPES.map((def) => [def.id, unit((r.shape as Record<string, unknown> | undefined)?.[def.id], 0.5)])),
    skin: color('skin'),
    hair: optional('hair', HAIR),
    hairColor: color('hairColor'),
    hat: optional('hat', HATS),
    hatColor: color('hatColor'),
    top: pick('top', TOPS),
    topColor: color('topColor'),
    bottom: pick('bottom', BOTTOMS),
    bottomColor: color('bottomColor'),
    shoes: pick('shoes', SHOES),
    shoesColor: color('shoesColor'),
  };
}

/** node name -> material colour for the parts the look keeps visible */
export function partColors(look: CustomLook): Record<string, string> {
  const out: Record<string, string> = {
    body: look.skin,
    eyes: '',
    lashes: '',
    brows: look.hairColor,
    ['bottom_' + look.bottom]: look.bottomColor,
    ['shoes_' + look.shoes]: look.shoesColor,
  };
  out['top_' + look.top] = look.topColor;
  if (look.hair) out['hair_' + look.hair] = look.hairColor;
  if (look.hat) out['hat_' + look.hat] = look.hatColor;
  return out;
}

/** CC BY authors of the themed add-on parts, for the credits */
export const EXTRA_AUTHORS: string[] = [
  ...new Set(
    [...OPT.extras.hats, ...OPT.extras.tops, ...OPT.extras.bottoms, ...OPT.extras.shoes].map((i) => (i as { author?: string }).author).filter((a): a is string => !!a),
  ),
];
