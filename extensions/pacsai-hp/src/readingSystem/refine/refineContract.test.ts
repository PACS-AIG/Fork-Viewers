import {
  REFINE_BUDGET,
  base64Length,
  buildSegmentRequest,
  readMask,
  readRefineTargets,
  readSegmentAnswer,
} from './refineContract';
import { RsRefused } from '../rsContract';
import {
  SHAPE,
  disc,
  makeTarget,
  packBox,
  segmentOk,
  targetJson,
  targetsDoc,
} from './refineTestData';

describe('refine targets document', () => {
  it('reads each target with its grid, revisions and outline', () => {
    const doc = readRefineTargets(targetsDoc([targetJson()]), 'fixture');
    expect(doc.dropped).toBe(0);
    expect(doc.targets).toHaveLength(1);
    const t = doc.targets[0];
    expect(t.kind).toBe('candidate');
    expect(t.grid.shape).toEqual(SHAPE);
    expect([t.seriesRevision, t.observationRevision, t.maskRevision]).toEqual([3, 7, 1]);
    expect(t.mask?.box).toEqual([
      [2, 8, 10],
      [3, 13, 15],
    ]);
    expect(t.promptTypes).toContain('box');
    expect(t.reported).toBe(false);
    expect(t.location).toEqual({ organOfOrigin: 'liver', laterality: null, third: null });
    expect(doc.revision).toBe(4);
    expect(doc.withheld).toEqual([]);
  });

  it('refuses another mode, another artifact and a document with no target list', () => {
    expect(() => readRefineTargets(targetsDoc([]), 'clinical')).toThrow(RsRefused);
    expect(() => readRefineTargets(targetsDoc([], { artifact: 'anatomy' }), 'fixture')).toThrow(
      RsRefused
    );
    expect(() => readRefineTargets(targetsDoc([], { targets: undefined }), 'fixture')).toThrow(
      'without a target list'
    );
  });

  it('leaves out (and counts) the targets it cannot read, never guessing', () => {
    const bad = [
      targetJson({ observationId: '' }),
      targetJson({ kind: 'lesion' }),
      targetJson({ seriesRevision: -1 }),
      targetJson({ grid: { shape: SHAPE, affineRAS: [[1, 0, 0, 0]] } }),
      // an outline without its revision, and a revision without an outline
      targetJson({ maskRevision: null }),
      targetJson({ mask: null }),
      // its box outside the grid
      targetJson({
        mask: {
          box: [
            [0, 0, 0],
            [7, 2, 2],
          ],
          bits: 'AAAA',
          digest: 'd',
        },
      }),
      // bits that do not cover the box
      targetJson({
        mask: {
          box: [
            [0, 0, 0],
            [1, 2, 8],
          ],
          bits: 'AAAA',
          digest: 'd',
        },
      }),
      // no outline and no geometry
      targetJson({ mask: null, maskRevision: null, geometry: null }),
    ];
    const doc = readRefineTargets(targetsDoc([...bad, targetJson()]), 'fixture');
    expect(doc.targets).toHaveLength(1);
    expect(doc.dropped).toBe(bad.length);
  });

  it('takes a lesion with no outline yet by its detector box', () => {
    const doc = readRefineTargets(
      targetsDoc([
        targetJson({
          mask: null,
          maskRevision: null,
          geometry: {
            type: 'box',
            world_mm: [
              [0, 0, 40],
              [5, 5, 40],
            ],
          },
        }),
      ]),
      'fixture'
    );
    expect(doc.targets[0].mask).toBeNull();
    expect(doc.targets[0].maskRevision).toBeNull();
    expect(doc.targets[0].geometry).toEqual({
      type: 'box',
      world: [
        [0, 0, 40],
        [5, 5, 40],
      ],
    });
  });
});

describe('withheld lesions', () => {
  it('reads why a lesion cannot be refined now, and leaves out what it cannot read', () => {
    const doc = readRefineTargets(
      targetsDoc([], {
        withheld: [
          { observationId: 'obs-9', entryId: null, reason: 'no SAM2CT backend is registered' },
          { observationId: 'obs-8', entryId: 'F2', reason: 'a later outline waits in the inbox' },
          { observationId: '', reason: 'x' },
          'not an entry',
        ],
      }),
      'fixture'
    );
    expect(doc.withheld).toEqual([
      { observationId: 'obs-9', entryId: null, reason: 'no SAM2CT backend is registered' },
      { observationId: 'obs-8', entryId: 'F2', reason: 'a later outline waits in the inbox' },
    ]);
  });
});

describe('packed outlines', () => {
  it('measures base64 exactly', () => {
    expect(base64Length('AAAA')).toBe(3);
    expect(base64Length('AAA=')).toBe(2);
    expect(base64Length('AA==')).toBe(1);
    expect(base64Length('AAA')).toBe(-1);
    expect(base64Length('A$A=')).toBe(-1);
  });

  it('takes a /segment mask only on the target’s grid', () => {
    const lo: [number, number, number] = [1, 1, 1];
    const hi: [number, number, number] = [2, 3, 4];
    const mask = { box: [lo, hi], bits: packBox(lo, hi, [[1, 1, 1]]), digest: 'd', voxels: 1 };
    expect(readMask({ ...mask, shape: SHAPE }, SHAPE)).toMatchObject({ box: [lo, hi], voxels: 1 });
    expect(readMask({ ...mask, shape: [6, 20, 25] }, SHAPE)).toBe('invalid');
    expect(readMask(null, SHAPE)).toBeNull();
  });
});

describe('refine request', () => {
  const target = makeTarget();
  const reader = { id: 'reader@example.test', role: 'radiologist' };

  it('names the lesion’s live revisions and runs its own recipe, not an alternate', () => {
    const req = buildSegmentRequest(
      target,
      {
        type: 'box',
        world: [
          [1, 2, 40],
          [6, 7, 40],
        ],
      },
      reader
    );
    expect(req).toEqual({
      mode: 'refine',
      seriesRef: target.seriesRef,
      series_revision: 3,
      parent_observation_id: 'obs-1',
      parent_observation_revision: 7,
      base_mask_revision: 1,
      prompt: {
        type: 'box',
        world_mm: [
          [1, 2, 40],
          [6, 7, 40],
        ],
        frameOfReferenceUID: target.frameOfReferenceUID,
      },
      recipe_id: 'sam2ct@pinned',
      task: 'hepatic_lesion_boundary',
      budget: { ...REFINE_BUDGET },
      reader,
    });
    expect(req).not.toHaveProperty('trigger');
    expect(req).not.toHaveProperty('alternative');
  });

  it('sends a click as one positive point, and a lesion with no outline with a null base', () => {
    const req = buildSegmentRequest(
      { ...target, mask: null, maskRevision: null },
      { type: 'point', world: [[1, 2, 40]] },
      reader
    );
    expect(req.prompt).toEqual({
      type: 'point',
      world_mm: [[1, 2, 40]],
      frameOfReferenceUID: target.frameOfReferenceUID,
      polarity: ['positive'],
    });
    expect(req.base_mask_revision).toBeNull();
  });

  it('refuses a mark with the wrong number of points (a programming error)', () => {
    expect(() =>
      buildSegmentRequest(target, { type: 'box', world: [[1, 2, 3]] }, reader)
    ).toThrow();
  });
});

describe('refine answer', () => {
  it('reads SAM2CT’s outline, its id, QC and run time', () => {
    const a = readSegmentAnswer(200, segmentOk(disc([10, 12], 3, [2, 3])), SHAPE);
    expect(a).toMatchObject({
      kind: 'result',
      status: 'ok',
      resultId: 'attempt-1',
      keep: { possible: true, reason: null },
      maskRevision: 2,
      runtimeS: 2.5,
      qc: { slices: 2, components: 1, partialVolume: false, truncated: false, passed: true },
    });
  });

  it('says whether the attempt can be kept, and why not', () => {
    const qcFailed = segmentOk(disc([10, 12], 3, [2]), {
      keep: {
        possible: false,
        reason: 'Its outline failed QC (partial volume), so it cannot be kept.',
      },
    });
    expect(readSegmentAnswer(200, qcFailed, SHAPE)).toMatchObject({
      keep: {
        possible: false,
        reason: 'Its outline failed QC (partial volume), so it cannot be kept.',
      },
    });
    const silent = segmentOk(disc([10, 12], 3, [2]), { keep: undefined });
    expect(readSegmentAnswer(200, silent, SHAPE)).toMatchObject({ keep: { possible: false } });
    const noOutline = segmentOk(disc([10, 12], 3, [2]), { mask: null });
    expect(readSegmentAnswer(200, noOutline, SHAPE)).toMatchObject({
      keep: { possible: false, reason: null },
    });
    const noId = segmentOk(disc([10, 12], 3, [2]), { resultId: null });
    expect(readSegmentAnswer(200, noId, SHAPE)).toMatchObject({
      keep: {
        possible: false,
        reason: 'The CT analysis service gave this outline no id, so it cannot be kept.',
      },
    });
  });

  it('gives the answer’s reason for an attempt with no outline, as one sentence (D-347)', () => {
    const body = segmentOk(disc([10, 12], 3, [2]), {
      mask: null,
      keep: {
        possible: false,
        reason:
          'SAM2CT isn’t running on the reading system’s host right now, so it drew no outline',
      },
    });
    (body.result as Record<string, unknown>).status = 'unavailable';
    (body.result as Record<string, unknown>).reasons = [
      'no container answers at http://segmenter:8090',
    ];
    expect(readSegmentAnswer(200, body, SHAPE)).toMatchObject({
      status: 'unavailable',
      reasons: ['no container answers at http://segmenter:8090'],
      keep: {
        possible: false,
        reason:
          'SAM2CT isn’t running on the reading system’s host right now, so it drew no outline.',
      },
    });
    // A reason in lower case without a stop is given its capital and its stop.
    const plain = segmentOk(disc([10, 12], 3, [2]), {
      keep: { possible: false, reason: 'what keeping it would change could not be computed' },
    });
    expect(readSegmentAnswer(200, plain, SHAPE)).toMatchObject({
      keep: { possible: false, reason: 'What keeping it would change could not be computed.' },
    });
  });

  it('says failed when "ok" comes with no outline', () => {
    const a = readSegmentAnswer(200, segmentOk(disc([10, 12], 3, [2]), { mask: null }), SHAPE);
    expect(a).toMatchObject({
      kind: 'result',
      status: 'failed',
      reasons: ['no outline came back'],
    });
  });

  it('keeps failed and unavailable as SAM2CT said them', () => {
    const body = segmentOk(disc([10, 12], 3, [2]), { mask: null });
    (body.result as Record<string, unknown>).status = 'unavailable';
    (body.result as Record<string, unknown>).reasons = ['the backend is not pinned'];
    expect(readSegmentAnswer(200, body, SHAPE)).toMatchObject({
      status: 'unavailable',
      reasons: ['the backend is not pinned'],
    });
  });

  it('reads stale (with the current revisions), refused and no pixels', () => {
    expect(
      readSegmentAnswer(
        409,
        { status: 'stale', reason: 'moved', current: { mask_revision: 4, bad: 'x' } },
        SHAPE
      )
    ).toEqual({ kind: 'stale', reason: 'moved', current: { mask_revision: 4 } });
    expect(readSegmentAnswer(422, { status: 'refused', reason: 'off the slice' }, SHAPE)).toEqual({
      kind: 'refused',
      reason: 'off the slice',
    });
    expect(readSegmentAnswer(503, null, SHAPE)).toMatchObject({ kind: 'no_pixels' });
  });

  it('gives null for anything else, so the caller says so', () => {
    expect(readSegmentAnswer(200, { result: { status: 'done' } }, SHAPE)).toBeNull();
    expect(readSegmentAnswer(200, null, SHAPE)).toBeNull();
    const wrongGrid = segmentOk(disc([10, 12], 3, [2]));
    (wrongGrid.mask as Record<string, unknown>).shape = [1, 2, 3];
    expect(readSegmentAnswer(200, wrongGrid, SHAPE)).toBeNull();
  });
});
