import baseRelevance from './scorers/baseRelevance';
import recency from './scorers/recency';
import indication from './scorers/indication';
import spineRegionGate, { DISQUALIFY } from './scorers/spineRegion';
import scorePrior from './scorePrior';
import { baseRegion, getBodyPart, getModality, getModalityFamily } from './metadata';
import { makeRanker, tierOfPrior } from './rankPriors';
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

describe('getBodyPart spine subregions', () => {
  it('classifies cervical/thoracic/lumbar spine as distinct spine regions', () => {
    expect(getBodyPart(study({ StudyDescription: 'MR CERVICAL SPINE WO AND W CONTRAST' }))).toBe(
      'spine-cervical'
    );
    expect(getBodyPart(study({ StudyDescription: 'MR THORACIC SPINE WO AND W CONTRAST' }))).toBe(
      'spine-thoracic'
    );
    expect(getBodyPart(study({ StudyDescription: 'MR LUMBAR SPINE WO AND W CONTRAST' }))).toBe(
      'spine-lumbar'
    );
    expect(getBodyPart(study({ StudyDescription: 'CT L-SPINE' }))).toBe('spine-lumbar');
    expect(getBodyPart(study({ StudyDescription: 'MRI SPINE SURVEY' }))).toBe('spine');
  });

  it('does not steal soft-tissue neck or chest/thorax exams', () => {
    expect(getBodyPart(study({ StudyDescription: 'MR SOFT TISSUE NECK' }))).toBe('neck');
    expect(getBodyPart(study({ StudyDescription: 'CT CHEST' }))).toBe('chest');
    expect(getBodyPart(study({ StudyDescription: 'MR THORAX' }))).toBe('chest');
  });
});

describe('spineRegionGate', () => {
  const at = (desc: string) => study({ Modality: 'MR', StudyDescription: desc, StudyDate: '20260528' });

  it('disqualifies a different-region spine sibling', () => {
    expect(
      spineRegionGate({ current: at('MR LUMBAR SPINE'), prior: at('MR CERVICAL SPINE') })
    ).toBe(DISQUALIFY);
    expect(
      spineRegionGate({ current: at('MR LUMBAR SPINE'), prior: at('MR THORACIC SPINE') })
    ).toBe(DISQUALIFY);
  });

  it('does not disqualify the same spine region or a generic spine study', () => {
    expect(spineRegionGate({ current: at('MR LUMBAR SPINE'), prior: at('MR LUMBAR SPINE') })).toBe(0);
    expect(spineRegionGate({ current: at('MR LUMBAR SPINE'), prior: at('MRI SPINE') })).toBe(0);
  });

  it('keeps the full pipeline from picking a same-day sibling region as a prior', () => {
    const scorers = [spineRegionGate, baseRelevance, recency, indication];
    const lumbar = at('MR LUMBAR SPINE WO AND W CONTRAST');
    const cervical = at('MR CERVICAL SPINE WO AND W CONTRAST');
    const priorLumbar = study({
      Modality: 'MR',
      StudyDescription: 'MR LUMBAR SPINE WO',
      StudyDate: '20250101',
    });
    // Sibling region is driven negative (well below any minScore) ...
    expect(scorePrior({ current: lumbar, prior: cervical }, scorers)).toBeLessThan(0);
    // ... while a genuine prior of the SAME region still scores high.
    expect(scorePrior({ current: lumbar, prior: priorLumbar }, scorers)).toBeGreaterThanOrEqual(100);
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

// ---------------------------------------------------------------------------
// Ported from the app repo's comparisonAutoFill.ts (commits 318dc90 / e6ac17a /
// 7def5ae), which found these on real data. The two vocabularies are meant to stay
// in step — if you change one, change the other.
// ---------------------------------------------------------------------------

describe('getBodyPart vocabulary', () => {
  const bp = (desc: string) => getBodyPart(study({ StudyDescription: desc }));

  // The four mechanisms that sent a description plainly naming its region to
  // 'unknown'. Each is a separate defect; a fix for one does not cover the others.
  it('reads stems that were written as prefixes but compiled with a closing boundary', () => {
    // `pancrea`, `vertebr` and `mammo` matched NOTHING before — not even the word
    // they were truncated from, since \b never fires mid-word.
    expect(bp('CT PANCREAS PROTOCOL')).toBe('abdomen');
    expect(bp('MR PANCREATIC DUCT')).toBe('abdomen');
    expect(bp('XR VERTEBRAL AUGMENTATION')).toBe('spine');
    expect(bp('MAMMOGRAM SCREENING BILATERAL')).toBe('breast');
    expect(bp('MAMMOGRAPHY DIAGNOSTIC LEFT')).toBe('breast');
  });

  it('reads plurals of a singular vocabulary term', () => {
    expect(bp('US DUP CAROTIDS BILATERAL')).toBe('neck');
    expect(bp('XR FINGERS 2+ VIEWS LEFT')).toBe('extremity');
    expect(bp('CT ORBITS WO CONTRAST')).toBe('head');
    expect(bp('XR RIBS LEFT 2 VIEWS')).toBe('chest');
  });

  it('reads a region delimited by underscores in a scanner protocol name', () => {
    // \b counts _ as a word character, so every protocol name hid its region.
    expect(bp('Vascular^001_PE_CHEST (Adult)')).toBe('chest');
    expect(bp('Neuro^001_HEAD_ROUTINE (Adult)')).toBe('head');
  });

  it('covers the anatomy the original table simply omitted', () => {
    expect(bp('CT CEREBRAL PERFUSION W CONTRAST')).toBe('head');
    expect(bp('CT MAXILLOFACIAL WO CONTRAST')).toBe('head');
    expect(bp('CT FOSSA/SELLA/IAC/ORBIT W CONTRAST')).toBe('head');
    expect(bp('CT THYROID W CONTRAST')).toBe('neck');
    expect(bp('CT ADRENAL PROTOCOL')).toBe('abdomen');
    expect(bp('MRI MRCP')).toBe('abdomen');
    expect(bp('XR SACRUM AND COCCYX')).toBe('spine');
    expect(bp('US SCROTUM')).toBe('pelvis');
    expect(bp('US OB LESS 14 WKS SINGLE OR FIRST GESTATION')).toBe('pelvis');
    expect(bp('DUPLEX LOWER EXT VENOUS')).toBe('extremity');
  });

  it('keeps the classifications the original table already got right', () => {
    // The widening must be additive: no description that already had an answer
    // may change it. (Verified across the app's 69,733-report corpus; these are
    // the shapes this repo's own tests and protocols depend on.)
    expect(bp('CXR Chest PA')).toBe('chest');
    expect(bp('ABD PEL W 5.00 Br40 ax')).toBe('abdomen');
    expect(bp('MR SOFT TISSUE NECK')).toBe('neck');
    expect(bp('MR THORAX')).toBe('chest');
    expect(bp('CT L-SPINE')).toBe('spine-lumbar');
    expect(bp('MR CERVICAL SPINE WO AND W CONTRAST')).toBe('spine-cervical');
    expect(bp('MR Knee')).toBe('extremity');
    expect(bp('unparseable 123')).toBe('unknown');
  });

  it('does not let `mandible` swallow the submandibular gland', () => {
    // anatomyBounded's lookbehind rejects a preceding letter, so the neck row
    // below head still claims it.
    expect(bp('US SUBMANDIBULAR GLAND')).toBe('neck');
  });
});

describe('getBodyPart protocol region group', () => {
  const bp = (desc: string) => getBodyPart(study({ StudyDescription: desc }));

  it('prefers the scanner region group over a word found deeper in the name', () => {
    // Positioning language lives inside the protocol name: ABOVE_HEAD is how the
    // arm was placed, not what was scanned.
    expect(bp('Upper Extremities^001_WRIST_ABOVE_HEAD (Adult)')).toBe('extremity');
  });

  it('does not let the group overrule a refinement of itself', () => {
    // Group is 'spine', the full string says 'spine-cervical'; the specific
    // answer is the right one.
    expect(bp('Spine^001_C_SPINE (Adult)')).toBe('spine-cervical');
    expect(bp('Spine^001_Cspine (Adult)')).toBe('spine-cervical');
  });

  it('leaves descriptions without a caret alone', () => {
    expect(bp('CT HEAD WO CONTRAST')).toBe('head');
  });
});

describe('getBodyPart sources', () => {
  it('trusts the study description over a coarse BodyPartExamined tag', () => {
    // Real case: a cervical spine protocol carrying BodyPartExamined "HEAD".
    // Priors reach getBodyPart with a description and nothing else, so a
    // tag-derived current would be compared against description-derived priors.
    const s = study({ StudyDescription: 'Spine^001_Cspine (Adult)', BodyPartExamined: 'HEAD' });
    expect(getBodyPart(s)).toBe('spine-cervical');
  });

  it('still falls back to the tag when the description names nothing', () => {
    const s = study({ StudyDescription: 'cryptic exam code 123', BodyPartExamined: 'CHEST' });
    expect(getBodyPart(s)).toBe('chest');
  });
});

describe('baseRegion', () => {
  it('flattens a spine level to bare spine and leaves everything else alone', () => {
    expect(baseRegion('spine-cervical')).toBe('spine');
    expect(baseRegion('spine-lumbar')).toBe('spine');
    expect(baseRegion('spine')).toBe('spine');
    expect(baseRegion('chest')).toBe('chest');
    expect(baseRegion('unknown')).toBe('unknown');
  });
});

describe('getModalityFamily', () => {
  const at = (mod: string) => study({ Modality: mod, StudyDescription: 'CXR Chest' });

  it('folds projection radiography into one family', () => {
    expect(getModalityFamily(at('CR'))).toBe('XR');
    expect(getModalityFamily(at('DX'))).toBe('XR');
    expect(getModalityFamily(at('RG'))).toBe('XR');
    expect(getModalityFamily(at('XR'))).toBe('XR');
  });

  it('leaves other modalities untouched', () => {
    expect(getModalityFamily(at('CT'))).toBe('CT');
    expect(getModalityFamily(at('MR'))).toBe('MR');
    expect(getModalityFamily(study({}))).toBeUndefined();
  });

  it('folds only AFTER skipping the ancillary modalities', () => {
    expect(getModalityFamily(study({ ModalitiesInStudy: 'PR\\CR' }))).toBe('XR');
  });

  it('leaves getModality raw — the prior switcher prints it', () => {
    // A rad reading a switcher row wants the exam's own "CR"/"DX", not "XR".
    expect(getModality(at('CR'))).toBe('CR');
    expect(getModality(at('DX'))).toBe('DX');
    expect(getModality(study({ ModalitiesInStudy: 'PR\\CR' }))).toBe('CR');
  });
});

describe('baseRelevance cross-anatomy table', () => {
  it('reaches its spine entries when the description names a level', () => {
    // CROSS_BODY_PART is keyed on bare 'spine' while getBodyPart returns a level
    // whenever the description names one, so 'spine-cervical>neck' missed and
    // scored 0 where the table says 40.
    const neck = study({ Modality: 'CT', StudyDescription: 'CT SOFT TISSUE NECK W CONTRAST' });
    const cspine = study({ Modality: 'CT', StudyDescription: 'CT CERVICAL SPINE WO CONTRAST' });
    expect(baseRelevance({ current: neck, prior: cspine })).toBe(40);
    expect(baseRelevance({ current: cspine, prior: neck })).toBe(40);
  });

  it('still scores 0 for a pair the table genuinely has no entry for', () => {
    const lspine = study({ Modality: 'MR', StudyDescription: 'MR LUMBAR SPINE' });
    const knee = study({ Modality: 'MR', StudyDescription: 'MR Knee' });
    expect(baseRelevance({ current: lspine, prior: knee })).toBe(0);
  });
});

describe('tierOfPrior', () => {
  const chest = (mod: string, desc = 'XR CHEST 2 VIEWS') =>
    study({ Modality: mod, StudyDescription: desc });

  it('puts a same-family projection prior in the top tier', () => {
    // The bug: a current CR against a prior DX chest compared RAW modalities, so
    // it landed in tier 1 alongside a prior CT and then lost to the CT on recency.
    expect(tierOfPrior(chest('CR'), chest('DX', 'XR CHEST 1 VIEW'))).toBe(0);
    expect(tierOfPrior(chest('CR'), chest('CT', 'CT CHEST WO CONTRAST'))).toBe(1);
  });

  it('demotes a cross-body prior to the last tier', () => {
    expect(tierOfPrior(chest('CT', 'CT CHEST'), study({ Modality: 'CT', StudyDescription: 'CT Head' }))).toBe(2);
  });

  it('treats an unknown reference body part as no match', () => {
    const cryptic = study({ Modality: 'CT', StudyDescription: 'unparseable 123' });
    expect(tierOfPrior(cryptic, study({ Modality: 'CT', StudyDescription: 'unparseable 123' }))).toBe(2);
  });
});

describe('makeRanker', () => {
  const at = (desc: string, date: string, mod: string) =>
    study({ Modality: mod, StudyDescription: desc, StudyDate: date, StudyTime: '120000' });

  const rank = (ref: StudyLike, priors: StudyLike[]) =>
    priors
      .map(prior => ({ prior, score: scorePrior({ current: ref, prior }, [baseRelevance, recency, indication]) }))
      .sort(makeRanker(ref))
      .map(({ prior }) => prior.StudyDescription);

  it('prefers a same-family projection prior over a more recent cross-modality one', () => {
    const current = at('XR CHEST 2 VIEWS', '20260901', 'CR');
    expect(
      rank(current, [at('CT CHEST WO CONTRAST', '20260810', 'CT'), at('XR CHEST 1 VIEW', '20260801', 'DX')])
    ).toEqual(['XR CHEST 1 VIEW', 'CT CHEST WO CONTRAST']);
  });

  it('takes the most recent within a tier, with score only breaking a tie', () => {
    const current = at('CT CHEST WO CONTRAST', '20260901', 'CT');
    expect(
      rank(current, [at('CT CHEST OLD', '20240101', 'CT'), at('CT CHEST RECENT', '20260801', 'CT')])
    ).toEqual(['CT CHEST RECENT', 'CT CHEST OLD']);
  });
});

describe('an unreadable prior must not outrank a readable one', () => {
  // The reported case, end to end. A prior whose body part is 'unknown' collects
  // SAME_MODALITY_UNKNOWN_BODY_PART (60), which clears minScore, while a
  // correctly-classified cross-body pair the table has no entry for scores 0 and
  // is filtered out — so being unreadable beat being read, and a cervical spine
  // CT hung against a brain perfusion study.
  const MIN_SCORE = 30;
  const at = (desc: string, date: string) =>
    study({ Modality: 'CT', StudyDescription: desc, StudyDate: date, StudyTime: '120000' });
  const scorers = [spineRegionGate, baseRelevance, recency, indication];

  it('does not qualify a brain perfusion study as the prior for a cervical spine CT', () => {
    const current = at('CT CERVICAL SPINE WO CONTRAST', '20260901');
    const perfusion = at('CT CEREBRAL PERFUSION W CONTRAST', '20260410');
    const head = at('CT HEAD WO CONTRAST', '20260615');

    // Both are now READ as head, so neither can collect the unknown-body fallback...
    expect(getBodyPart(perfusion)).toBe('head');
    expect(getBodyPart(head)).toBe('head');
    // ... and head is not a comparison for a cervical spine study at all.
    const qualifying = [perfusion, head]
      .map(prior => scorePrior({ current, prior }, scorers))
      .filter(score => score >= MIN_SCORE);
    expect(qualifying).toEqual([]);
  });

  it("picks the patient's own prior mammogram over a more recent chest CT", () => {
    const current = study({ Modality: 'MG', StudyDescription: 'MAMMOGRAM SCREENING BILATERAL', StudyDate: '20260901' });
    const priorMammo = study({ Modality: 'MG', StudyDescription: 'MAMMOGRAM DIAGNOSTIC LEFT', StudyDate: '20250901' });
    const chestCt = study({ Modality: 'CT', StudyDescription: 'CT CHEST WO CONTRAST', StudyDate: '20260801' });

    const ranked = [priorMammo, chestCt]
      .map(prior => ({ prior, score: scorePrior({ current, prior }, scorers) }))
      .filter(({ score }) => score >= MIN_SCORE)
      .sort(makeRanker(current));
    expect(ranked[0].prior.StudyDescription).toBe('MAMMOGRAM DIAGNOSTIC LEFT');
  });
});
