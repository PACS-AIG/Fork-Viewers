import baseRelevance from './scorers/baseRelevance';
import recency from './scorers/recency';
import indication from './scorers/indication';
import scorePrior from './scorePrior';
import { StudyLike } from './types';

const study = (overrides: Partial<StudyLike>): StudyLike => ({
  StudyInstanceUID: Math.random().toString(),
  ...overrides,
});

describe('baseRelevance', () => {
  it('same modality + same body part scores highest', () => {
    const current = study({ Modality: 'CR', StudyDescription: 'CXR Chest PA' });
    const prior = study({ Modality: 'CR', StudyDescription: 'CXR Chest' });
    expect(baseRelevance({ current, prior })).toBe(100);
  });

  it('CXR with prior CT chest scores higher than CT with prior CXR', () => {
    const cxr = study({ Modality: 'CR', StudyDescription: 'CXR Chest' });
    const ctChest = study({ Modality: 'CT', StudyDescription: 'CT Chest' });
    expect(baseRelevance({ current: cxr, prior: ctChest })).toBe(80);
    expect(baseRelevance({ current: ctChest, prior: cxr })).toBe(60);
  });

  it('MR brain and CT head are mutually highly relevant', () => {
    const mrBrain = study({ Modality: 'MR', StudyDescription: 'MR Brain' });
    const ctHead = study({ Modality: 'CT', StudyDescription: 'CT Head' });
    expect(baseRelevance({ current: mrBrain, prior: ctHead })).toBe(75);
    expect(baseRelevance({ current: ctHead, prior: mrBrain })).toBe(75);
  });

  it('cross-body-part overlap scores moderate/low and directional', () => {
    const ctAbd = study({ Modality: 'CT', StudyDescription: 'CT Abdomen' });
    const cxr = study({ Modality: 'CR', StudyDescription: 'CXR Chest' });
    expect(baseRelevance({ current: ctAbd, prior: cxr })).toBe(50);
    expect(baseRelevance({ current: cxr, prior: ctAbd })).toBe(40);
  });

  it('returns 0 for unrelated anatomy with known body parts', () => {
    const ctHead = study({ Modality: 'CT', StudyDescription: 'CT Head' });
    const mrKnee = study({ Modality: 'MR', StudyDescription: 'MR Knee' });
    expect(baseRelevance({ current: ctHead, prior: mrKnee })).toBe(0);
  });

  it('recognizes abbreviated descriptions (ABD PEL)', () => {
    const current = study({ Modality: 'CT', StudyDescription: 'ABD PEL W 5.00 Br40 ax' });
    const prior = study({ Modality: 'CT', StudyDescription: 'ABD PELVIS WITH 5.00 Br40 ax' });
    expect(baseRelevance({ current, prior })).toBe(100);
  });

  it('falls back to modality when body part is unknown (never drops same-modality priors)', () => {
    const a = study({ Modality: 'CT', StudyDescription: 'unparseable 123' });
    const b = study({ Modality: 'CT', StudyDescription: 'xyz protocol' });
    const c = study({ Modality: 'MR', StudyDescription: 'xyz protocol' });
    expect(baseRelevance({ current: a, prior: b })).toBe(60);
    expect(baseRelevance({ current: a, prior: c })).toBe(20);
  });
});

describe('recency', () => {
  const base = { Modality: 'CT', StudyDescription: 'CT Chest' };
  const at = (d: string) => study({ ...base, StudyDate: d });

  it('applies date-bucket bonuses relative to the current study', () => {
    const current = at('20240101');
    expect(recency({ current, prior: at('20240101') })).toBe(20); // same day
    expect(recency({ current, prior: at('20231228') })).toBe(15); // within a week
    expect(recency({ current, prior: at('20231215') })).toBe(10); // within a month
    expect(recency({ current, prior: at('20231101') })).toBe(5); // within 3 months
    expect(recency({ current, prior: at('20230601') })).toBe(0); // within a year
    expect(recency({ current, prior: at('20220101') })).toBe(-10); // older than a year
  });

  it('returns 0 when a date is missing', () => {
    expect(recency({ current: at('20240101'), prior: study(base) })).toBe(0);
  });
});

describe('indication', () => {
  it('rewards a shared clinical finding keyword', () => {
    const current = study({ StudyDescription: 'CT Chest follow-up nodule' });
    const prior = study({ StudyDescription: 'CT Chest pulmonary nodule' });
    expect(indication({ current, prior })).toBe(25);
  });

  it('gives a small bonus for generic description overlap', () => {
    const current = study({ StudyDescription: 'MR Brain with contrast' });
    const prior = study({ StudyDescription: 'MR Brain routine' });
    expect(indication({ current, prior })).toBe(15);
  });

  it('returns 0 with no overlap or missing descriptions', () => {
    expect(
      indication({
        current: study({ StudyDescription: 'CT Chest' }),
        prior: study({ StudyDescription: 'MR Knee' }),
      })
    ).toBe(0);
    expect(indication({ current: study({}), prior: study({}) })).toBe(0);
  });
});

describe('scorePrior', () => {
  it('sums the scorers (same-day same CXR follow-up)', () => {
    const current = study({
      Modality: 'CR',
      StudyDescription: 'CXR Chest follow-up pneumonia',
      StudyDate: '20240101',
    });
    const prior = study({
      Modality: 'CR',
      StudyDescription: 'CXR Chest pneumonia',
      StudyDate: '20240101',
    });
    // base 100 + recency 20 + indication 20 (pneumonia)
    expect(scorePrior({ current, prior }, [baseRelevance, recency, indication])).toBe(140);
  });

  it('is fault tolerant when a scorer throws', () => {
    const throwing = () => {
      throw new Error('boom');
    };
    const current = study({});
    const prior = study({});
    expect(scorePrior({ current, prior }, [() => 5, throwing, () => 3])).toBe(8);
  });
});
