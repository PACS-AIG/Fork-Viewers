import { RsRefused } from '../rsContract';
import { RsHttpError } from '../rsClient';
import { readShowcase, type RsShowcase } from './showcaseContract';
import { createShowcaseStore, noneServedReason, type ShowcaseClient } from './showcaseStore';
import { PICTURES, makeShowcase, sha } from './showcaseTestData';

const flush = async (n = 30) => {
  for (let i = 0; i < n; i++) {
    await new Promise(r => setTimeout(r, 0));
  }
};

function setup(
  over: Partial<ShowcaseClient> = {},
  deps: { digest?: ((b: Uint8Array) => Promise<string>) | null; parallel?: number } = {}
) {
  let urls = 0;
  const pictureUrl = {
    create: jest.fn((_b: Uint8Array) => `blob:picture-${++urls}`),
    revoke: jest.fn(),
  };
  const client = {
    showcase: (over.showcase ??
      jest.fn(async () => readShowcase(makeShowcase(), 'fixture'))) as jest.Mock,
    showcaseImage: (over.showcaseImage ??
      jest.fn(async (name: string) => PICTURES[name])) as jest.Mock,
  };
  const store = createShowcaseStore({
    client,
    digest: deps.digest === undefined ? async b => sha(b) : deps.digest,
    pictureUrl,
    parallel: deps.parallel,
  });
  return { store, client, pictureUrl };
}

describe("PathGrade's research showcase, read for its tab (RS-36)", () => {
  it('reads nothing until opened, then the showcase and each picture once, its bytes checked', async () => {
    const { store, client, pictureUrl } = setup({}, { parallel: 2 });
    expect(store.getSnapshot().phase).toBe('idle');
    expect(client.showcase).not.toHaveBeenCalled();
    store.open();
    expect(store.getSnapshot().phase).toBe('loading');
    await flush();
    const snap = store.getSnapshot();
    expect(snap.phase).toBe('ready');
    expect(snap.showcase?.title).toBe('PathGrade on public kidney tumours');
    // In the order the sections show them.
    expect(client.showcaseImage.mock.calls.map(c => c[0])).toEqual([
      'outline_KiTS-00001.png',
      'outline_KiTS-00002.png',
      'growth_KiTS-00003.png',
    ]);
    expect(Object.values(snap.pictures).map(p => [p.state, Boolean(p.url)])).toEqual([
      ['ready', true],
      ['ready', true],
      ['ready', true],
    ]);
    expect(pictureUrl.create).toHaveBeenCalledTimes(3);
    expect(store.harnessState()).toMatchObject({
      phase: 'ready',
      sections: 2,
      items: { text: 1, facts: 1, figure: 2, table: 1 },
      unknownItems: 0,
      images: 3,
      pictures: { ready: 3 },
      counts: { reads: 1, pictures: 3, refusedPictures: 0 },
    });
    // Opened again: nothing is read again.
    store.open();
    await flush();
    expect(client.showcase).toHaveBeenCalledTimes(1);
    expect(client.showcaseImage).toHaveBeenCalledTimes(3);
  });

  it('never shows a picture whose bytes are not the ones listed, nor one it cannot check', async () => {
    const { store, pictureUrl } = setup({
      showcaseImage: jest.fn(async (name: string) =>
        name === 'outline_KiTS-00002.png' ? new Uint8Array([0]) : PICTURES[name]
      ),
    });
    store.open();
    await flush();
    const pictures = store.getSnapshot().pictures;
    expect(pictures['outline_KiTS-00002.png']).toEqual({
      state: 'refused',
      url: null,
      reason: 'Its bytes are not the ones the showcase lists, so it is not shown.',
    });
    expect(pictures['outline_KiTS-00001.png'].state).toBe('ready');
    expect(pictureUrl.create).toHaveBeenCalledTimes(2);

    const noCrypto = setup({}, { digest: null });
    noCrypto.store.open();
    await flush();
    expect(Object.values(noCrypto.store.getSnapshot().pictures).map(p => p.state)).toEqual([
      'refused',
      'refused',
      'refused',
    ]);
    expect(noCrypto.client.showcaseImage).not.toHaveBeenCalled();
    expect(noCrypto.store.getSnapshot().pictures['outline_KiTS-00001.png'].reason).toMatch(
      /cannot check a picture’s bytes/
    );

    const missing = setup({
      showcaseImage: jest.fn(async () => {
        throw new RsHttpError(404, 'showcase picture');
      }),
    });
    missing.store.open();
    await flush();
    expect(missing.store.getSnapshot().pictures['outline_KiTS-00001.png'].reason).toBe(
      'It could not be read (HTTP 404).'
    );
  });

  it('says plainly when no showcase is served, in the API’s words', async () => {
    const none = setup({
      showcase: jest.fn(async () => {
        throw new RsHttpError(
          404,
          'PathGrade showcase',
          'no PathGrade showcase is served: none is configured'
        );
      }),
    });
    none.store.open();
    await flush();
    expect(none.store.getSnapshot()).toMatchObject({
      phase: 'none',
      reason: 'No PathGrade showcase is served: none is configured.',
    });
    // Opened again: a 404 is an answer, not read again on this page.
    none.store.open();
    await flush();
    expect(none.client.showcase).toHaveBeenCalledTimes(1);
    expect(noneServedReason('Not Found')).toBe(
      'The CT analysis service serves no PathGrade showcase here.'
    );
    expect(noneServedReason(null)).toBe(
      'The CT analysis service serves no PathGrade showcase here.'
    );
    expect(
      noneServedReason('no PathGrade showcase is served: refused (another registry bundle).')
    ).toBe('No PathGrade showcase is served: refused (another registry bundle).');
    expect(noneServedReason('no PathGrade showcase is served: 1.2.3.4.5.6 missing')).not.toMatch(
      /1\.2\.3/
    );
  });

  it('says why a showcase is refused, and lets a failed read be tried again', async () => {
    const refused = setup({
      showcase: jest.fn(async () => {
        throw new RsRefused('The PathGrade showcase cannot be shown: its use is not research.');
      }),
    });
    refused.store.open();
    await flush();
    expect(refused.store.getSnapshot()).toMatchObject({
      phase: 'refused',
      reason: 'The PathGrade showcase cannot be shown: its use is not research.',
    });
    let fail = true;
    const flaky = setup({
      showcase: jest.fn(async () => {
        if (fail) {
          throw new RsHttpError(502, 'PathGrade showcase');
        }
        return readShowcase(makeShowcase(), 'fixture');
      }),
    });
    flaky.store.open();
    await flush();
    expect(flaky.store.getSnapshot()).toMatchObject({
      phase: 'failed',
      reason: 'The PathGrade showcase could not be read (HTTP 502).',
    });
    fail = false;
    flaky.store.open();
    await flush();
    expect(flaky.store.getSnapshot().phase).toBe('ready');
  });

  it('lets go of its pictures when the pane leaves, and of an answer that comes after', async () => {
    const { store, pictureUrl } = setup();
    store.open();
    await flush();
    const urls = Object.values(store.getSnapshot().pictures).map(p => p.url);
    store.leave();
    expect(store.getSnapshot()).toMatchObject({ phase: 'idle', showcase: null, pictures: {} });
    expect(pictureUrl.revoke.mock.calls.map(c => c[0]).sort()).toEqual([...urls].sort());

    let answer: (v: RsShowcase) => void = () => {};
    const late = setup({
      showcase: jest.fn(() => new Promise<RsShowcase>(r => (answer = r))),
    });
    late.store.open();
    late.store.leave();
    answer(readShowcase(makeShowcase(), 'fixture'));
    await flush();
    expect(late.store.getSnapshot().phase).toBe('idle');
    expect(late.client.showcaseImage).not.toHaveBeenCalled();
  });
});
