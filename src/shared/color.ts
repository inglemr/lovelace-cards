// Colour helpers. Governing rule for the room card: HUE IS DATA, NOT ATMOSPHERE.
// A light's real hue is only ever painted in the ≤8px pill dot (calm-clamped
// here) or inside an editor surface the user opened — never in card glow/washes.

export type RGB = [number, number, number];

const srgbToLinear = (c: number) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

/** sRGB → OKLCH {L 0..1, C, H degrees}. */
export function rgbToOklch([r, g, b]: RGB): { L: number; C: number; H: number } {
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const C = Math.sqrt(a * a + bb * bb);
  let H = (Math.atan2(bb, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L, C, H };
}

const DOT_L_MIN = 0.7, DOT_L_MAX = 0.8, DOT_C_MAX = 0.11, DOT_C_MIN = 0.04;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Calm, domesticated dot colour for a real RGB. Returns null when the light is
 *  effectively white (caller should fall through to the colour-temperature path). */
export function calmDotColor(rgb: RGB): string | null {
  const { L, C, H } = rgbToOklch(rgb);
  if (C < DOT_C_MIN) return null;
  const l = clamp(L, DOT_L_MIN, DOT_L_MAX);
  const c = Math.min(C, DOT_C_MAX);
  return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${H.toFixed(1)})`;
}

/** Dot colour for a colour-temperature light: warm→ivory→whisper-cool, only at
 *  dot scale (never the banned blue-white ambient). */
export function kelvinDotColor(k: number): string {
  if (k <= 4500) {
    const t = clamp((k - 2200) / (4500 - 2200), 0, 1);
    return `color-mix(in srgb, #f2a93b ${Math.round((1 - t) * 100)}%, #ffe8c2)`;
  }
  const t = clamp((k - 4500) / (6500 - 4500), 0, 1);
  return `color-mix(in srgb, #ffe8c2 ${Math.round((1 - t) * 100)}%, #d9e6f0)`;
}

/** Full-saturation hue → RGB for the custom colour picker (editor surface only). */
export function hueToRgb(h: number, s = 1, v = 1): RGB {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
