// Colour pipeline for light-derived UI: turn a light's reported colour into a
// theme-safe display colour. Brightness is NEVER encoded in the hue (bulb RGB is
// chromaticity, not dimness) — callers encode brightness via opacity/size.

export type RGB = [number, number, number];

// Warm→cool colour-temperature anchors (Kelvin → representative RGB).
const KELVIN_ANCHORS: { k: number; rgb: RGB }[] = [
  { k: 2200, rgb: [255, 157, 69] },
  { k: 2700, rgb: [255, 180, 107] },
  { k: 3500, rgb: [255, 210, 161] },
  { k: 4500, rgb: [255, 243, 224] },
  { k: 5500, rgb: [244, 247, 255] },
  { k: 6500, rgb: [223, 233, 255] },
];

export function kelvinToRgb(k: number): RGB {
  if (k <= KELVIN_ANCHORS[0].k) return KELVIN_ANCHORS[0].rgb;
  const last = KELVIN_ANCHORS[KELVIN_ANCHORS.length - 1];
  if (k >= last.k) return last.rgb;
  for (let i = 0; i < KELVIN_ANCHORS.length - 1; i++) {
    const a = KELVIN_ANCHORS[i];
    const b = KELVIN_ANCHORS[i + 1];
    if (k >= a.k && k <= b.k) {
      const t = (k - a.k) / (b.k - a.k);
      return [
        Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t),
        Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t),
        Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t),
      ];
    }
  }
  return KELVIN_ANCHORS[1].rgb;
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s * 100, l * 100];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Theme-safe display colour for a reported RGB. Lightness fixed per theme so a
 *  dim bulb never renders as a dark smear; saturation clamped so it reads. */
export function displayColor(rgb: RGB, dark: boolean): string {
  let [h, s] = rgbToHsl(rgb);
  // near-white (unsaturated) → treat as a warm 3000K tungsten, not grey
  if (s < 15) {
    [h, s] = rgbToHsl(kelvinToRgb(3000));
  }
  s = clamp(s, 40, 90);
  const l = dark ? 62 : 48;
  return `hsl(${Math.round(h)} ${Math.round(s)}% ${l}%)`;
}
