/**
 * The study-metadata promise cache (Rev 11 milestone 6 part 2): one viewer
 * document now holds up to 12 cases, so a failure must not stay cached for the
 * document. deleteStudyMetadataPromise uses the key retrieveStudyMetadata
 * writes; a study-level or series-level failure evicts its entry (only its own,
 * by identity); a return to the study retries. RetrieveMetadata is the test's.
 */
const mockRetrieve = jest.fn();
jest.mock('./wado/retrieveMetadata.js', () => ({
  __esModule: true,
  default: (...args) => mockRetrieve(...args),
}));

import { retrieveStudyMetadata, deleteStudyMetadataPromise } from './retrieveStudyMetadata';

/**
 * The lazy loader's DeferredPromise (wado/retrieveMetadataLoaderAsync.js), by
 * its interface: the request is `processFunction`, set by setProcessFunction,
 * made once by start(). That module cannot load under this package's jest
 * mapper (its '@ohif/core/src/...' import maps to a path that does not exist).
 */
class DeferredPromise {
  processFunction = undefined;
  internalPromise = undefined;
  setProcessFunction(func) {
    this.processFunction = func;
  }
  start() {
    if (this.internalPromise) {
      return this.internalPromise;
    }
    this.internalPromise = this.processFunction();
    return this.internalPromise;
  }
}

const CONFIG = { name: 'dicomweb-gw1' };
const CLIENT = {};
let study = 0;
/** A fresh synthetic study UID per test: the cache is module state. */
const nextStudy = () => `1.2.840.99.7.${++study}`;

/** One lazy series whose metadata request is the given function. */
function series(request) {
  const deferred = new DeferredPromise();
  deferred.setProcessFunction(request);
  return deferred;
}

/** The lazy loader's answer: a series list and one deferred per series. */
const lazyAnswer = (...requests) => ({
  preLoadData: requests.map((_, i) => ({ SeriesInstanceUID: `1.2.840.99.8.${i}` })),
  promises: requests.map(series),
});

const retrieve = uid => retrieveStudyMetadata(CLIENT, uid, true, {}, undefined, undefined, CONFIG);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  // A retrieve the test did not plan answers too, so an extra one fails on the
  // call count, not as a crash.
  mockRetrieve.mockReset().mockImplementation(async () => lazyAnswer(async () => ['unplanned']));
});

describe('retrieveStudyMetadata: the cache', () => {
  it('answers a second retrieve of a study from the cache', async () => {
    const uid = nextStudy();
    mockRetrieve.mockResolvedValue(lazyAnswer(async () => ['instance']));
    const first = retrieve(uid);
    expect(retrieve(uid)).toBe(first);
    await first;
    expect(mockRetrieve).toHaveBeenCalledTimes(1);
  });

  it('deleteStudyMetadataPromise removes the entry by the key retrieve wrote, so the next retrieve asks again', async () => {
    const uid = nextStudy();
    mockRetrieve.mockResolvedValue(lazyAnswer(async () => ['instance']));
    await retrieve(uid);
    deleteStudyMetadataPromise(uid, CONFIG);
    await retrieve(uid);
    expect(mockRetrieve).toHaveBeenCalledTimes(2);
  });

  it('a bare UID or another source name is not the key, and deletes nothing', async () => {
    const uid = nextStudy();
    mockRetrieve.mockResolvedValue(lazyAnswer(async () => ['instance']));
    await retrieve(uid);
    deleteStudyMetadataPromise(uid);
    deleteStudyMetadataPromise(uid, { name: 'dicomweb-gw2' });
    await retrieve(uid);
    expect(mockRetrieve).toHaveBeenCalledTimes(1);
  });
});

describe('retrieveStudyMetadata: a failure evicts, so a return retries', () => {
  it('study level: a rejected series query evicts the study, and the return retrieves it again', async () => {
    const uid = nextStudy();
    mockRetrieve.mockRejectedValueOnce(new Error('502 from the archive'));
    await expect(retrieve(uid)).rejects.toThrow('502 from the archive');

    mockRetrieve.mockResolvedValueOnce(lazyAnswer(async () => ['instance']));
    const back = await retrieve(uid);
    expect(mockRetrieve).toHaveBeenCalledTimes(2);
    await expect(back.promises[0].start()).resolves.toEqual(['instance']);
  });

  it('series level: one series metadata GET that fails evicts the study; the caller still gets the rejection; the return builds a new entry and that series is fetched again', async () => {
    const uid = nextStudy();
    const firstVisitRequests = { ok: jest.fn(async () => ['ok']), bad: jest.fn() };
    firstVisitRequests.bad.mockRejectedValue(new Error('401 on series metadata'));
    mockRetrieve.mockResolvedValueOnce(lazyAnswer(firstVisitRequests.ok, firstVisitRequests.bad));

    const firstVisit = await retrieve(uid);
    await expect(firstVisit.promises[0].start()).resolves.toEqual(['ok']);
    await expect(firstVisit.promises[1].start()).rejects.toThrow('401 on series metadata');
    await settle();

    const retried = jest.fn(async () => ['fetched again']);
    mockRetrieve.mockResolvedValueOnce(lazyAnswer(async () => ['ok'], retried));
    const back = await retrieve(uid);
    expect(mockRetrieve).toHaveBeenCalledTimes(2);
    expect(back).not.toBe(firstVisit);
    await expect(back.promises[1].start()).resolves.toEqual(['fetched again']);
    expect(retried).toHaveBeenCalledTimes(1);
    // The first visit's request (its client, its headers) is not re-run.
    expect(firstVisitRequests.bad).toHaveBeenCalledTimes(1);
  });

  it('series level: a request that throws as it is made evicts too', async () => {
    const uid = nextStudy();
    mockRetrieve.mockResolvedValueOnce(
      lazyAnswer(() => {
        throw new Error('no client');
      })
    );
    const firstVisit = await retrieve(uid);
    expect(() => firstVisit.promises[0].start()).toThrow('no client');

    mockRetrieve.mockResolvedValueOnce(lazyAnswer(async () => ['instance']));
    await retrieve(uid);
    expect(mockRetrieve).toHaveBeenCalledTimes(2);
  });

  it('series that all answer keep the entry cached', async () => {
    const uid = nextStudy();
    mockRetrieve.mockResolvedValueOnce(
      lazyAnswer(
        async () => ['a'],
        async () => ['b']
      )
    );
    const firstVisit = await retrieve(uid);
    await Promise.all(firstVisit.promises.map(p => p.start()));
    await settle();
    expect(await retrieve(uid)).toBe(firstVisit);
    expect(mockRetrieve).toHaveBeenCalledTimes(1);
  });

  it('identity: a late series failure of an entry already replaced does not remove the newer entry', async () => {
    const uid = nextStudy();
    let failLate;
    const lateFailure = new Promise((_, reject) => {
      failLate = () => reject(new Error('late 500'));
    });
    mockRetrieve.mockResolvedValueOnce(lazyAnswer(() => lateFailure));
    const older = await retrieve(uid);
    const olderSeries = older.promises[0].start();

    // The entry is replaced (deleted, then retrieved again) while the old GET is out.
    deleteStudyMetadataPromise(uid, CONFIG);
    mockRetrieve.mockResolvedValueOnce(lazyAnswer(async () => ['newer']));
    const newer = await retrieve(uid);

    failLate();
    await expect(olderSeries).rejects.toThrow('late 500');
    await settle();
    expect(await retrieve(uid)).toBe(newer);
    expect(mockRetrieve).toHaveBeenCalledTimes(2);
  });

  it('identity: a late study failure of an entry already replaced does not remove the newer entry', async () => {
    const uid = nextStudy();
    let failLate;
    mockRetrieve.mockReturnValueOnce(
      new Promise((_, reject) => {
        failLate = () => reject(new Error('late 503'));
      })
    );
    const older = retrieve(uid);
    deleteStudyMetadataPromise(uid, CONFIG);
    mockRetrieve.mockResolvedValueOnce(lazyAnswer(async () => ['newer']));
    const newer = retrieve(uid);
    await newer;

    failLate();
    await expect(older).rejects.toThrow('late 503');
    await settle();
    expect(retrieve(uid)).toBe(newer);
    expect(mockRetrieve).toHaveBeenCalledTimes(2);
  });
});
