import { readSegmentAnswer, type SegmentAnswer, type SegmentRequest } from './refineContract';
import { createRefineStore, describePreview, type RefineStoreDeps } from './refineStore';
import { RsHttpError } from '../rsClient';
import {
  FOR,
  SERIES,
  SHAPE,
  disc,
  gridAffine,
  makeTarget,
  makeTargets,
  segmentOk,
  worldAt,
} from './refineTestData';
import type { RsIntakeResponse } from '../rsContract';

const STUDY = 'study-under-test';
const affine = gridAffine();
const at = (c: number, r: number, k: number) => worldAt(affine, c, r, k);
const shown = { seriesUID: SERIES, frameOfReferenceUID: FOR };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const intake = (over: Partial<RsIntakeResponse> = {}): RsIntakeResponse => ({
  contractVersion: 'pacsai.reading/1.18',
  artifact: 'intake_response',
  eventId: 'e',
  studyUID: STUDY,
  status: 'applied',
  httpStatus: 200,
  revision: 5,
  ...over,
});
const okAnswer = (over: Record<string, unknown> = {}) =>
  readSegmentAnswer(200, segmentOk(disc([10, 12], 3, [2, 3]), over), SHAPE) as SegmentAnswer;

function setup(over: Partial<RefineStoreDeps> = {}) {
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  let targets = makeTargets([
    makeTarget({ entryId: 'entry-1', kind: 'finding' }, disc([10, 12], 2.2, [2])),
  ]);
  const requests: SegmentRequest[] = [];
  let answer: () => Promise<SegmentAnswer> = async () => okAnswer();
  const keeps: string[] = [];
  const discards: string[] = [];
  const keepAnswers: Array<RsIntakeResponse | null> = [];
  const selected: string[] = [];
  let reads = 0;
  const deps: RefineStoreDeps = {
    client: {
      refineTargets: async () => {
        reads++;
        return targets;
      },
      segment: async request => {
        requests.push(request);
        return answer();
      },
    },
    reader: () => ({ id: 'reader@example.test', role: 'radiologist' }),
    keep: async resultId => {
      keeps.push(resultId);
      return keepAnswers.length ? (keepAnswers.shift() as RsIntakeResponse | null) : intake();
    },
    discard: async resultId => {
      discards.push(resultId);
      return intake({ status: 'recorded' });
    },
    selectEntry: id => selected.push(id),
    now: () => 1000,
    setTimer: (fn, ms) => {
      const t = { fn, ms, live: true };
      timers.push(t);
      return t;
    },
    clearTimer: h => {
      (h as { live: boolean }).live = false;
    },
    studyRef: () => 'study-ref',
    ...over,
  };
  const store = createRefineStore(deps);
  return {
    store,
    requests,
    keeps,
    discards,
    keepAnswers,
    selected,
    reads: () => reads,
    setTargets: (t: typeof targets) => {
      targets = t;
    },
    setAnswer: (fn: () => Promise<SegmentAnswer>) => {
      answer = fn;
    },
    fireTimers: () =>
      timers
        .filter(t => t.live)
        .forEach(t => {
          t.live = false;
          t.fn();
        }),
  };
}

async function ready(over: Partial<RefineStoreDeps> = {}) {
  const s = setup(over);
  s.store.enter(STUDY);
  await flush();
  s.store.setArmed(true);
  return s;
}

async function boxAround(s: Awaited<ReturnType<typeof ready>>) {
  s.store.beginMark('vp-1', at(8, 6, 2));
  s.store.moveMark(at(16, 14, 2), 30);
  s.store.endMark(shown);
  await flush();
}

describe('refine store', () => {
  it('reads the study’s targets when it enters, and says when there are none', async () => {
    const s = setup();
    s.store.enter(STUDY);
    expect(s.store.getView().targetsState).toBe('loading');
    await flush();
    expect(s.store.getView().targetsState).toBe('ready');
    expect(s.store.getView().targets).toHaveLength(1);

    const none = setup();
    none.setTargets({
      ...makeTargets([]),
      withheld: [
        { observationId: 'obs-9', entryId: null, reason: 'no SAM2CT backend is registered' },
      ],
    });
    none.store.enter(STUDY);
    await flush();
    expect(none.store.getView().targetsState).toBe('none');
    expect(none.store.getView().withheld).toHaveLength(1);

    const notServed = setup({
      client: {
        refineTargets: async () => {
          throw new RsHttpError(404, 'refine targets');
        },
        segment: async () => {
          throw new Error('unused');
        },
      },
    });
    notServed.store.enter(STUDY);
    await flush();
    expect(notServed.store.getView().targetsState).toBe('none');
  });

  it('marks only while the tool is active', async () => {
    const s = setup();
    s.store.enter(STUDY);
    await flush();
    s.store.beginMark('vp-1', at(12, 10, 2));
    expect(s.store.getView().phase).toBe('idle');
    s.store.setArmed(true);
    s.store.beginMark('vp-1', at(12, 10, 2));
    expect(s.store.getView().phase).toBe('drawing');
    s.store.setArmed(false);
    expect(s.store.getView().phase).toBe('idle');
  });

  it('a short drag is a click, a longer one a box', async () => {
    const s = await ready();
    s.store.beginMark('vp-1', at(12, 10, 2));
    s.store.moveMark(at(12.2, 10, 2), 2);
    expect(s.store.getView().mark?.type).toBe('point');
    s.store.moveMark(at(16, 14, 2), 12);
    expect(s.store.getView().mark).toEqual({
      type: 'box',
      world: [at(12, 10, 2), at(16, 14, 2)],
    });
  });

  it('sends the lesion’s refine, then shows SAM2CT’s outline beside the current one', async () => {
    const s = await ready();
    await boxAround(s);
    expect(s.requests).toHaveLength(1);
    expect(s.requests[0]).toMatchObject({
      parent_observation_id: 'obs-1',
      base_mask_revision: 1,
      prompt: { type: 'box' },
      reader: { id: 'reader@example.test' },
    });
    const v = s.store.getView();
    expect(v.phase).toBe('preview');
    expect(v.viewportId).toBe('vp-1');
    expect(v.preview?.resultId).toBe('attempt-1');
    expect(v.preview?.keep).toEqual({ possible: true, reason: null });
    expect(v.preview?.against).toEqual({
      seriesRevision: 3,
      observationRevision: 7,
      maskRevision: 1,
    });
    expect(v.preview?.unpacked.slices).toEqual([2, 3]);
    expect(v.message?.text).toMatch(/^SAM2CT’s outline: \d+ voxels on 2 slices\.$/);
  });

  it('selects the lesion in the pane only when the report renders it', async () => {
    const quiet = await ready();
    await boxAround(quiet);
    expect(quiet.selected).toEqual([]);

    const reported = setup();
    reported.setTargets(
      makeTargets([
        makeTarget(
          { entryId: 'entry-1', kind: 'finding', reported: true },
          disc([10, 12], 2.2, [2])
        ),
      ])
    );
    reported.store.enter(STUDY);
    await flush();
    reported.store.setArmed(true);
    await boxAround(reported);
    expect(reported.selected).toEqual(['entry-1']);
  });

  it('says why when a mark names nothing, and lets the note fade', async () => {
    const s = await ready();
    s.store.beginMark('vp-1', at(0, 0, 2));
    s.store.endMark(shown);
    expect(s.store.getView().phase).toBe('missed');
    expect(s.store.getView().message?.text).toBe('No lesion the system found is here.');
    expect(s.requests).toHaveLength(0);
    s.fireTimers();
    expect(s.store.getView().phase).toBe('idle');
    s.store.refuseMark('vp-2', 'Draw on the series’ own slices.');
    expect(s.store.getView()).toMatchObject({ phase: 'missed', viewportId: 'vp-2' });
  });

  it('keeps it by accepting the attempt, then reads the targets again', async () => {
    const s = await ready();
    await boxAround(s);
    const readsBefore = s.reads();
    await s.store.keep();
    expect(s.keeps).toEqual(['attempt-1']);
    expect(s.reads()).toBe(readsBefore + 1);
    const v = s.store.getView();
    expect(v.phase).toBe('kept');
    expect(v.preview).toBeNull();
    expect(v.message?.text).toBe('Kept: the liver lesion’s outline is the new one.');
    s.fireTimers();
    expect(s.store.getView().phase).toBe('idle');
  });

  it('offers no keep for an outline the answer says cannot be kept, and says why', async () => {
    const s = await ready();
    const reason = 'Its outline failed QC (partial volume), so it cannot be kept.';
    s.setAnswer(async () => okAnswer({ keep: { possible: false, reason } }));
    await boxAround(s);
    expect(s.store.getView().message?.level).toBe('warn');
    expect(s.store.getView().message?.text.endsWith(`. ${reason}`)).toBe(true);
    await s.store.keep();
    expect(s.keeps).toEqual([]);
    s.store.discard();
    expect(s.discards).toEqual([]);
  });

  it('sends a keep answered 409 again when only the published revision moved', async () => {
    const s = await ready();
    await boxAround(s);
    s.keepAnswers.push(
      intake({ status: 'conflict', httpStatus: 409, currentRevision: 6, reason: 'base 5 -> 6' })
    );
    await s.store.keep();
    expect(s.keeps).toEqual(['attempt-1', 'attempt-1']);
    expect(s.store.getView().phase).toBe('kept');
  });

  it('asks for a new mark when a keep is answered 409 because the attempt’s evidence moved', async () => {
    const s = await ready();
    await boxAround(s);
    s.keepAnswers.push(
      intake({
        status: 'conflict',
        httpStatus: 409,
        reason: 'base_mask_revision 1 -> 2: draw again',
      })
    );
    await s.store.keep();
    expect(s.keeps).toEqual(['attempt-1']);
    expect(s.store.getView()).toMatchObject({ phase: 'answered', preview: null, canRetry: false });
    expect(s.store.getView().message?.text).toMatch(/mark it again\.$/);

    // The same when the targets read again hold other revisions, whatever the reason says.
    const moved = await ready();
    await boxAround(moved);
    moved.setTargets(
      makeTargets([
        makeTarget(
          { entryId: 'entry-1', kind: 'finding', maskRevision: 2 },
          disc([10, 12], 2.2, [2])
        ),
      ])
    );
    moved.keepAnswers.push(
      intake({ status: 'conflict', httpStatus: 409, reason: 'base revision moved' })
    );
    await moved.store.keep();
    expect(moved.keeps).toHaveLength(1);
    expect(moved.store.getView().phase).toBe('answered');
  });

  it('says so when the keep did not apply', async () => {
    const s = await ready();
    await boxAround(s);
    s.keepAnswers.push(null);
    await s.store.keep();
    expect(s.store.getView().phase).toBe('preview');
    expect(s.store.getView().message?.text).toMatch(/^Not kept: the change did not go/);
    s.keepAnswers.push(
      intake({ status: 'rejected', httpStatus: 422, reason: 'the study is not open for editing' })
    );
    await s.store.keep();
    expect(s.store.getView().message?.text).toBe('Not kept: the study is not open for editing.');
    s.keepAnswers.push(
      intake({
        status: 'rejected',
        httpStatus: 422,
        reason: 'refine-0123456789abcdef0123 is not an open proposal',
      })
    );
    await s.store.keep();
    expect(s.store.getView()).toMatchObject({ phase: 'answered', preview: null, canRetry: true });
    expect(s.store.getView().message?.text).toMatch(/^This outline can no longer be kept/);
  });

  it('discards a keepable outline by rejecting its attempt', async () => {
    const s = await ready();
    await boxAround(s);
    s.store.discard();
    expect(s.discards).toEqual(['attempt-1']);
    expect(s.store.getView()).toMatchObject({ phase: 'idle', preview: null, mark: null });
  });

  it('reads the targets again when the lesion moved on (stale), and asks for a new mark', async () => {
    const s = await ready();
    s.setAnswer(async () => ({ kind: 'stale', reason: 'moved', current: { mask_revision: 2 } }));
    const readsBefore = s.reads();
    await boxAround(s);
    expect(s.store.getView()).toMatchObject({ phase: 'answered', canRetry: false });
    expect(s.store.getView().message?.text).toMatch(/changed since this page read it/);
    expect(s.reads()).toBe(readsBefore + 1);
  });

  it('says what the service said for refused, no outline, and no answer', async () => {
    const s = await ready();
    s.setAnswer(async () => ({
      kind: 'refused',
      reason: 'sam2ct@pinned takes a box on one slice',
    }));
    await boxAround(s);
    expect(s.store.getView().message?.text).toBe(
      'Not refined: sam2ct@pinned takes a box on one slice.'
    );
    expect(s.store.getView().canRetry).toBe(false);

    s.setAnswer(async () => ({
      kind: 'result',
      status: 'unavailable',
      reasons: ['the backend is not pinned'],
      resultId: null,
      keep: { possible: false, reason: null },
      maskRevision: null,
      mask: null,
      qc: null,
      runtimeS: null,
    }));
    await boxAround(s);
    expect(s.store.getView().message?.text).toBe(
      'SAM2CT gave no outline (unavailable: the backend is not pinned).'
    );

    // With the answer's own reason for the reader (D-347), the bar gives that instead.
    s.setAnswer(async () => ({
      kind: 'result',
      status: 'unavailable',
      reasons: ['no container answers at http://segmenter:8090'],
      resultId: 'attempt-2',
      keep: {
        possible: false,
        reason:
          'SAM2CT isn’t running on the reading system’s host right now, so it drew no outline.',
      },
      maskRevision: null,
      mask: null,
      qc: null,
      runtimeS: 0.8,
    }));
    await boxAround(s);
    expect(s.store.getView().message?.text).toBe(
      'SAM2CT isn’t running on the reading system’s host right now, so it drew no outline.'
    );

    s.setAnswer(async () => {
      throw new RsHttpError(502, 'refine');
    });
    await boxAround(s);
    expect(s.store.getView()).toMatchObject({ phase: 'answered', canRetry: true });
    expect(s.store.getView().message?.text).toBe(
      'The CT analysis service did not answer in time. Try again.'
    );
    s.setAnswer(async () => okAnswer());
    await s.store.retry();
    expect(s.store.getView().phase).toBe('preview');
    expect(s.requests.at(-1)?.prompt).toEqual(s.requests[0].prompt);
  });

  it('leaves nothing behind on leave', async () => {
    const s = await ready();
    await boxAround(s);
    s.store.leave();
    expect(s.store.getView()).toMatchObject({
      phase: 'idle',
      targetsState: 'idle',
      targets: [],
      withheld: [],
    });
  });

  it('drops an answer that comes after the study changed', async () => {
    let release: (a: SegmentAnswer) => void = () => undefined;
    const s = await ready();
    s.setAnswer(() => new Promise(resolve => (release = resolve)));
    s.store.beginMark('vp-1', at(8, 6, 2));
    s.store.moveMark(at(16, 14, 2), 30);
    s.store.endMark(shown);
    expect(s.store.getView().phase).toBe('sending');
    s.store.enter('another-study');
    release(okAnswer());
    await flush();
    expect(s.store.getView().phase).toBe('idle');
  });

  it('describes QC plainly', () => {
    const s = describePreview({
      mask: {
        box: [
          [0, 0, 0],
          [1, 1, 1],
        ],
        bits: 'gA==',
        digest: 'd',
        voxels: 1,
      },
      unpacked: { lo: [0, 0, 0], dims: [1, 1, 1], data: Uint8Array.of(1), voxels: 1, slices: [4] },
      resultId: 'a',
      maskRevision: 2,
      qc: {
        slices: 1,
        components: 2,
        partialVolume: true,
        truncated: true,
        passed: false,
        failures: ['partial_volume'],
      },
      keep: { possible: false, reason: 'x' },
      against: { seriesRevision: 1, observationRevision: 1, maskRevision: 1 },
    });
    expect(s).toBe(
      '1 voxel on 1 slice; 2 pieces; partial volume (under two slices); cut off at the edge of what SAM2CT saw; QC failed: partial_volume'
    );
  });

  it('names the study by reference only, in the harness', async () => {
    const s = await ready();
    await boxAround(s);
    const h = s.store.harnessState();
    expect(h).toMatchObject({
      study: 'study-ref',
      phase: 'preview',
      keepPossible: true,
      target: { kind: 'finding', label: 'liver lesion' },
    });
    expect(JSON.stringify(h)).not.toContain(STUDY);
  });
});
