import { act, fireEvent } from '@testing-library/react';
import { readSegmentAnswer, type SegmentAnswer } from './refineContract';
import { createRefineBarHost } from './refineBarHost';
import { createRefineStore } from './refineStore';
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

const flush = async (n = 5) => {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
  }
};
const affine = gridAffine();
const at = (c: number, r: number, k: number) => worldAt(affine, c, r, k);

async function setup() {
  let answer: () => Promise<SegmentAnswer> = async () =>
    readSegmentAnswer(200, segmentOk(disc([10, 12], 3, [2, 3])), SHAPE) as SegmentAnswer;
  const keeps: unknown[] = [];
  const store = createRefineStore({
    client: {
      refineTargets: async () => makeTargets([makeTarget({}, disc([10, 12], 2.2, [2]))]),
      segment: async () => answer(),
    },
    reader: () => ({ id: 'r', role: 'radiologist' }),
    keep: async k => {
      keeps.push(k);
      return { status: 'applied', revision: 4 } as RsIntakeResponse;
    },
    now: () => 0,
    setTimer: () => null,
    clearTimer: () => undefined,
    studyRef: () => 'ref',
  });
  const viewport = document.createElement('div');
  document.body.appendChild(viewport);
  let host: ReturnType<typeof createRefineBarHost> = { destroy: () => undefined };
  act(() => {
    host = createRefineBarHost({
      win: window,
      store,
      elementOf: id => (id === 'vp-1' ? viewport : null),
    });
  });
  await act(async () => {
    store.enter('study');
  });
  await flush();
  act(() => store.setArmed(true));
  const mark = async () => {
    await act(async () => {
      store.beginMark('vp-1', at(8, 6, 2));
      store.moveMark(at(16, 14, 2), 30);
      store.endMark({ seriesUID: SERIES, frameOfReferenceUID: FOR });
    });
    await flush();
  };
  return {
    store,
    viewport,
    host,
    keeps,
    mark,
    setAnswer: (fn: () => Promise<SegmentAnswer>) => {
      answer = fn;
    },
    bar: () => viewport.querySelector('[data-rs-refine-bar]') as HTMLElement | null,
    status: () =>
      viewport.querySelector('[data-rs-refine-bar] [role="status"]')?.textContent ?? null,
    button: (name: string) =>
      [...viewport.querySelectorAll('button')].find(b => b.textContent === name) as
        | HTMLButtonElement
        | undefined,
  };
}

describe('refine bar', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is in the marked viewport only while a refine is in hand', async () => {
    const s = await setup();
    expect(s.viewport.querySelector('[data-pacsai-refine-bar-host]')).toBeNull();
    await s.mark();
    expect(s.bar()?.getAttribute('data-rs-refine-bar')).toBe('preview');
    act(() => s.store.discard());
    expect(s.viewport.querySelector('[data-pacsai-refine-bar-host]')).toBeNull();
    act(() => s.host.destroy());
  });

  it('keys the two outlines and offers Keep, Discard and Try again', async () => {
    const s = await setup();
    await s.mark();
    expect(s.status()).toMatch(/^SAM2CT’s outline: \d+ voxels on 2 slices\. The current one\.$/);
    expect(s.button('Keep')?.disabled).toBe(false);
    expect(s.button('Discard')).toBeDefined();
    expect(s.button('Try again')).toBeDefined();
    await act(async () => {
      fireEvent.click(s.button('Keep') as HTMLButtonElement);
    });
    await flush();
    expect(s.keeps).toEqual(['attempt-1']);
    expect(s.bar()?.getAttribute('data-rs-refine-bar')).toBe('kept');
    expect(s.status()).toBe('Kept: the liver lesion’s outline is the new one.');
    act(() => s.host.destroy());
  });

  it('offers no Keep for an outline that cannot be kept, and says why', async () => {
    const s = await setup();
    const reason = 'Its outline failed QC (partial volume), so it cannot be kept.';
    s.setAnswer(
      async () =>
        readSegmentAnswer(
          200,
          segmentOk(disc([10, 12], 3, [2]), { keep: { possible: false, reason } }),
          SHAPE
        ) as SegmentAnswer
    );
    await s.mark();
    expect(s.bar()?.getAttribute('data-rs-refine-bar')).toBe('preview');
    expect(s.status()?.endsWith(`The current one. ${reason}`)).toBe(true);
    expect(s.button('Keep')).toBeUndefined();
    expect(s.button('Discard')).toBeDefined();
    act(() => s.host.destroy());
  });

  it('keeps its pointer events from the viewport under it', async () => {
    const s = await setup();
    await s.mark();
    const seen: string[] = [];
    for (const type of ['pointerdown', 'mousedown', 'click', 'wheel']) {
      s.viewport.addEventListener(type, () => seen.push(type));
    }
    const bar = s.bar() as HTMLElement;
    fireEvent.pointerDown(bar);
    fireEvent.mouseDown(bar);
    fireEvent.click(bar);
    fireEvent.wheel(bar);
    expect(seen).toEqual([]);
    act(() => s.host.destroy());
  });

  it('says what went wrong, with Try again when it may help', async () => {
    const s = await setup();
    s.setAnswer(async () => ({ kind: 'refused', reason: 'off the slice' }));
    await s.mark();
    expect(s.bar()?.getAttribute('data-rs-refine-bar')).toBe('answered');
    expect(s.bar()?.getAttribute('data-level')).toBe('error');
    expect(s.status()).toBe('Not refined: off the slice.');
    expect(s.button('Try again')).toBeUndefined();
    expect(s.button('Close')).toBeDefined();
    act(() => s.host.destroy());
  });

  it('counts the seconds while SAM2CT works', async () => {
    let release: (a: SegmentAnswer) => void = () => undefined;
    const s = await setup();
    s.setAnswer(() => new Promise(resolve => (release = resolve)));
    await s.mark();
    expect(s.bar()?.getAttribute('data-rs-refine-bar')).toBe('sending');
    expect(s.status()).toMatch(/^Refining the liver lesion… \d+ s$/);
    await act(async () => {
      release(readSegmentAnswer(200, segmentOk(disc([10, 12], 3, [2])), SHAPE) as SegmentAnswer);
    });
    await flush();
    expect(s.bar()?.getAttribute('data-rs-refine-bar')).toBe('preview');
    act(() => s.host.destroy());
  });
});
