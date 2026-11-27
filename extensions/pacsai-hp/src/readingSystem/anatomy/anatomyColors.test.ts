import { isVertebra, labelColor, spinalLevel, vertebraColor } from './anatomyColors';

describe('the anatomy layers’ vertebra colours (RS-36)', () => {
  it('places a vertebra down the spine by its display phrase, or else its class name', () => {
    expect(spinalLevel({ rawClass: 'vertebrae_C1', name: 'C1 vertebra' })).toBe(0);
    expect(spinalLevel({ rawClass: null, name: 'T1 vertebral body' })).toBe(7);
    expect(spinalLevel({ rawClass: 'vertebrae_T12', name: 'T12 vertebra' })).toBe(18);
    expect(spinalLevel({ rawClass: 'vertebrae_L1', name: 'L1 vertebral body' })).toBe(19);
    expect(spinalLevel({ rawClass: 'vertebrae_S1', name: 'S1 vertebra' })).toBe(25);
    // A phrase that names no level leaves it to the class name.
    expect(spinalLevel({ rawClass: 'vertebrae_L5', name: 'fifth lumbar vertebra' })).toBe(23);
    // No level, or one past its region's count.
    expect(spinalLevel({ rawClass: 'vertebrae', name: 'vertebra' })).toBeNull();
    expect(spinalLevel({ rawClass: 'vertebrae_T13', name: 'T13 vertebra' })).toBeNull();
    expect(spinalLevel({ rawClass: 'sacrum', name: 'sacrum' })).toBeNull();
  });

  it('never gives neighbouring levels one colour, from C1 to S5, with or without a sixth lumbar', () => {
    const levels = [
      ...Array.from({ length: 7 }, (_, i) => `C${i + 1}`),
      ...Array.from({ length: 12 }, (_, i) => `T${i + 1}`),
      ...Array.from({ length: 5 }, (_, i) => `L${i + 1}`),
      ...Array.from({ length: 5 }, (_, i) => `S${i + 1}`),
    ];
    const colour = (level: string) =>
      labelColor({ rawClass: null, name: `${level} vertebra`, value: 1 });
    // Each level that shares its colour with the one above it.
    const clashes = levels
      .slice(1)
      .filter((level, i) => `${colour(level)}` === `${colour(levels[i])}`);
    expect(clashes).toEqual([]);
    expect(colour('L6')).not.toEqual(colour('L5'));
    expect(colour('L6')).not.toEqual(colour('S1'));
  });

  it('gives a level one colour whatever its label value, task or wording', () => {
    const body = labelColor({ rawClass: 'vertebrae_L5', name: 'L5 vertebral body', value: 7 });
    const whole = labelColor({ rawClass: 'vertebrae_L5', name: 'L5 vertebra', value: 23 });
    expect(body).toEqual(whole);
    expect(body).toEqual(vertebraColor(23));
    // Case 4 on dev: total's S1 beside vertebrae_pp's L5 body.
    expect(labelColor({ rawClass: 'vertebrae_S1', name: 'S1 vertebra', value: 1 })).not.toEqual(
      body
    );
  });

  it('colours a vertebra that names no level by its value, as before', () => {
    const v = { rawClass: 'vertebrae', name: 'vertebra', value: 3 };
    expect(isVertebra(v)).toBe(true);
    expect(labelColor(v)).toEqual(vertebraColor(2));
  });
});
