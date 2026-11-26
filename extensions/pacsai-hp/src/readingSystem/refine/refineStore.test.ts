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

const applied = (revision = 5): RsIntakeResponse => ({
  contractVersion: 'pacsai.reading/1.18',
  artifact: 'intake_response',
  eventId: 'e',
  studyUID: STUDY,
  status: 'applied',
  httpStatus: 200,
  revision,
});

function setup(over: Partial<RefineStoreDeps> = {}) {
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  let targets = makeTargets([
    makeTarget({ entryId: 'entry-1', kind: 'finding' }, disc([10, 12], 2.2, [2])),
  ]);
  const requests: SegmentRequest[] = [];
  let answer: () => Promise<SegmentAnswer> = async () =>
    readSegmentAnswer(200, segmentOk(disc([10, 12], 3, [2, 3])), SHAPE) as SegmentAnswer;
  const keeps: unknown[] = [];
  let keepAnswer: RsIntakeResponse | null = applied();
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
    keep: async k => {
      keeps.push(k);
      return keepAnswer;
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
    selected,
    reads: () => reads,
    setTargets: (t: typeof targets) => {
      targets = t;
    },
    setAnswer: (fn: () => Promise<SegmentAnswer>) => {
      answer = fn;
    },
    setKeepAnswer: (a: RsIntakeResponse | null) => {
      keepAnswer = a;
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

async function ready() {
  const s = setup();
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
    none.setTargets(makeTargets([]));
    none.store.enter(STUDY);
    await flush();
    expect(none.store.getView().targetsState).toBe('none');

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
    expect(s.store.getView().mark).toEqual({ type: 'box', world: [at(12, 10, 2), at(16, 14, 2)] });
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
    expect(s.selected).toEqual(['entry-1']);
    const v = s.store.getView();
    expect(v.phase).toBe('preview');
    expect(v.viewportId).toBe('vp-1');
    expect(v.preview?.resultId).toBe('attempt-1');
    expect(v.preview?.unpacked.slices).toEqual([2, 3]);
    expect(v.message?.text).toMatch(/^SAM2CT’s outline: \d+ voxels on 2 slices\.$/);
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

  it('keeps it through the pane, then reads the targets again', async () => {
    const s = await ready();
    await boxAround(s);
    const readsBefore = s.reads();
    await s.store.keep();
    expect(s.keeps).toEqual([{ resultId: 'attempt-1', observationId: 'obs-1', maskRevision: 2 }]);
    expect(s.reads()).toBe(readsBefore + 1);
    const v = s.store.getView();
    expect(v.phase).toBe('kept');
    expect(v.preview).toBeNull();
    expect(v.message?.text).toBe('Kept: the liver lesion’s outline is the new one.');
    s.fireTimers();
    expect(s.store.getView().phase).toBe('idle');
  });

  it('keeps the preview, and says so, when the keep did not apply', async () => {
    const s = await ready();
    await boxAround(s);
    s.setKeepAnswer(null);
    await s.store.keep();
    expect(s.store.getView().phase).toBe('preview');
    expect(s.store.getView().message?.text).toMatch(/^Not kept: the change did not go/);
    s.setKeepAnswer({ ...applied(), status: 'conflict', httpStatus: 409 });
    await s.store.keep();
    expect(s.store.getView().message?.text).toBe(
      'Not kept: the record moved before this reached it. Mark the lesion again.'
    );
    s.setKeepAnswer({
      ...applied(),
      status: 'rejected',
      httpStatus: 422,
      reason: 'not an attempt of this lesion',
    });
    await s.store.keep();
    expect(s.store.getView().message?.text).toBe('Not kept: not an attempt of this lesion.');
  });

  it('cannot keep an outline the service kept no attempt of', async () => {
    const s = await ready();
    s.setAnswer(
      async () =>
        readSegmentAnswer(
          200,
          segmentOk(disc([10, 12], 3, [2]), { resultId: undefined }),
          SHAPE
        ) as SegmentAnswer
    );
    await boxAround(s);
    await s.store.keep();
    expect(s.keeps).toHaveLength(0);
    expect(s.store.getView().message?.text).toMatch(/keeps no refine attempts yet/);
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
      maskRevision: null,
      mask: null,
      qc: null,
      runtimeS: null,
    }));
    await boxAround(s);
    expect(s.store.getView().message?.text).toBe(
      'SAM2CT gave no outline (unavailable: the backend is not pinned).'
    );

    s.setAnswer(async () => {
      throw new RsHttpError(502, 'refine');
    });
    await boxAround(s);
    expect(s.store.getView()).toMatchObject({ phase: 'answered', canRetry: true });
    expect(s.store.getView().message?.text).toBe(
      'The CT analysis service did not answer in time. Try again.'
    );
    s.setAnswer(
      async () => readSegmentAnswer(200, segmentOk(disc([10, 12], 3, [2])), SHAPE) as SegmentAnswer
    );
    await s.store.retry();
    expect(s.store.getView().phase).toBe('preview');
    expect(s.requests.at(-1)?.prompt).toEqual(s.requests[0].prompt);
  });

  it('discards SAM2CT’s outline, and leaves nothing behind on leave', async () => {
    const s = await ready();
    await boxAround(s);
    s.store.discard();
    expect(s.store.getView()).toMatchObject({ phase: 'idle', preview: null, mark: null });
    await boxAround(s);
    s.store.leave();
    expect(s.store.getView()).toMatchObject({ phase: 'idle', targetsState: 'idle', targets: [] });
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
    release(readSegmentAnswer(200, segmentOk(disc([10, 12], 3, [2])), SHAPE) as SegmentAnswer);
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
      target: { kind: 'finding', label: 'liver lesion' },
    });
    expect(JSON.stringify(h)).not.toContain(STUDY);
  });
});
