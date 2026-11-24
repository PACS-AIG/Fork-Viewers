/**
 * RS-36: the anatomy layers' colours.
 *
 * The viewer's own palette, chosen to read on a CT's greys: organs in hues
 * close to how anatomy atlases tint them (arteries red, veins blue, bone
 * pale), keyed by words in TotalSegmentator's class names, paired left and
 * right structures one hue apart in lightness, vertebrae cycling through
 * distinct hues so neighbouring levels never share one, and every other
 * label a golden-angle hue of its own. Deterministic: the same label always
 * gets the same colour.
 *
 * Pure: no window, React or OHIF here.
 */

export type Rgb = [number, number, number];

/** Words in a class name (or the display phrase) and their hue. First match wins. */
const BY_WORD: Array<[RegExp, Rgb]> = [
  [/liver|hepat/, [190, 104, 78]],
  [/spleen|splen(?!ic)/, [148, 96, 176]],
  [/kidney|renal/, [222, 96, 112]],
  [/adrenal/, [240, 196, 84]],
  [/gallbladder|gall_bladder/, [88, 184, 96]],
  [/pancrea/, [244, 210, 118]],
  [/stomach|gastric/, [238, 148, 86]],
  [/duodenum/, [232, 172, 104]],
  [/small_bowel|small bowel|jejunum|ileum/, [236, 186, 142]],
  [/colon|rectum|bowel/, [200, 160, 108]],
  [/esophag|oesophag/, [214, 136, 118]],
  [/aorta|artery|arterial|trunk_brachio|carotid|subclavian/, [228, 62, 62]],
  [/vena|vein|venous|portal/, [72, 116, 228]],
  [/heart|atri|ventric|myocard/, [204, 70, 92]],
  [/pericard/, [214, 122, 164]],
  [/lung|pulmon/, [234, 158, 182]],
  [/trachea|bronch/, [146, 210, 234]],
  [/bladder/, [238, 216, 106]],
  [/prostate|uterus|ovary/, [182, 140, 206]],
  [/spinal_cord|spinal cord/, [250, 232, 136]],
  [/brain|cerebr/, [232, 200, 178]],
  [/thyroid/, [158, 212, 138]],
  [/rib|sternum|clavic|scapula|humerus|femur|hip|pelvi|sacrum|skull|bone/, [222, 206, 164]],
  [/gluteus|iliopsoas|psoas|autochthon|muscle/, [188, 92, 82]],
  [/abdominal_cavity|abdominal cavity|peritone/, [96, 176, 196]],
  [/thoracic_cavity|thoracic cavity|pleura/, [128, 150, 226]],
  [/mediastin/, [166, 136, 214]],
];

/** Neighbouring vertebrae never share a hue. */
const VERTEBRA_CYCLE: Rgb[] = [
  [236, 196, 92],
  [92, 196, 206],
  [214, 116, 196],
  [140, 206, 112],
  [236, 140, 92],
  [128, 146, 236],
];

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

/** Lighter (amount > 0) or darker (amount < 0), by a fraction of the way to white or black. */
export function shade(rgb: Rgb, amount: number): Rgb {
  return amount >= 0
    ? [
        clamp(rgb[0] + (255 - rgb[0]) * amount),
        clamp(rgb[1] + (255 - rgb[1]) * amount),
        clamp(rgb[2] + (255 - rgb[2]) * amount),
      ]
    : [clamp(rgb[0] * (1 + amount)), clamp(rgb[1] * (1 + amount)), clamp(rgb[2] * (1 + amount))];
}

/** HSL (h in degrees, s and l in 0..1) to RGB. */
export function hsl(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = l - c / 2;
  return [clamp((r + m) * 255), clamp((g + m) * 255), clamp((b + m) * 255)];
}

/** A vertebra, by its class name or display phrase. */
export const isVertebra = (label: { rawClass: string | null; name: string }): boolean =>
  /vertebra|vertebrae|^\s*[ctl]\d{1,2}\b/.test(
    `${label.rawClass ?? ''} ${label.name}`.toLowerCase()
  );

/**
 * The n-th vertebra from the head's colour: the store recolours a task's
 * vertebrae in their head-to-feet order once its labelmap is read, since their
 * values need not follow the spine (T9 is 9 and L1 is 1 on dev).
 */
export const vertebraColor = (rank: number): Rgb =>
  VERTEBRA_CYCLE[((rank % VERTEBRA_CYCLE.length) + VERTEBRA_CYCLE.length) % VERTEBRA_CYCLE.length];

/** A label's colour from its class name (or display phrase) and value. */
export function labelColor(label: { rawClass: string | null; name: string; value: number }): Rgb {
  const words = `${label.rawClass ?? ''} ${label.name}`.toLowerCase();
  if (isVertebra(label)) {
    return vertebraColor(label.value - 1);
  }
  for (const [pattern, rgb] of BY_WORD) {
    if (pattern.test(words)) {
      if (/(^|[_\s])left\b|_left\b|\bleft\b/.test(words)) {
        return shade(rgb, -0.18);
      }
      if (/(^|[_\s])right\b|_right\b|\bright\b/.test(words)) {
        return shade(rgb, 0.16);
      }
      return rgb;
    }
  }
  return hsl((label.value * 137.508) % 360, 0.62, 0.6);
}

/** As CSS. */
export const cssColor = (rgb: Rgb): string => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
