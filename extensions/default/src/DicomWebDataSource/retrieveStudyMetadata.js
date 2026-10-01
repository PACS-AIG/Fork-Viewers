import retrieveMetadataFiltered from './utils/retrieveMetadataFiltered.js';
import RetrieveMetadata from './wado/retrieveMetadata.js';

const moduleName = 'RetrieveStudyMetadata';
// Cache for promises. Prevents unnecessary subsequent calls to the server
const StudyMetaDataPromises = new Map();

/** The cache key: the data source's name and the study. */
const promiseIdFor = (StudyInstanceUID, dicomWebConfig = {}) =>
  `${dicomWebConfig.name}:${StudyInstanceUID}`;

/**
 * pacsai (Rev 11 milestone 6 part 2): with lazy load, the cached study promise
 * resolves once the series list is in, with one DeferredPromise per series that
 * the caller starts later. A series whose metadata request fails would stay
 * rejected inside that resolved entry, so the series stayed missing on every
 * return to the study for the life of the document (which now holds up to 12
 * cases). Wrap each series' request where it is made, so a failure evicts the
 * study's entry. Not through DeferredPromise.then, which returns undefined
 * before start(). The caller still gets the rejection; the next retrieve builds
 * a new entry with the data source's current client and auth headers, rather
 * than re-running a request bound to the first visit's client.
 */
function evictOnSeriesFailure(data, evict) {
  const seriesPromises = data?.promises;
  if (!Array.isArray(seriesPromises)) {
    return;
  }
  seriesPromises.forEach(deferred => {
    const request = deferred?.processFunction;
    if (typeof request !== 'function' || typeof deferred.setProcessFunction !== 'function') {
      return;
    }
    deferred.setProcessFunction(() => {
      let result;
      try {
        result = request();
      } catch (error) {
        evict();
        throw error;
      }
      result?.then?.(undefined, evict);
      return result;
    });
  });
}

/**
 * Retrieves study metadata.
 *
 * @param {Object} dicomWebClient The DICOMWebClient instance to be used for series load
 * @param {string} StudyInstanceUID The UID of the Study to be retrieved
 * @param {boolean} enableStudyLazyLoad Whether the study metadata should be loaded asynchronously.
 * @param {Object} [filters] Object containing filters to be applied on retrieve metadata process
 * @param {string} [filters.seriesInstanceUID] Series instance uid to filter results against
 * @param {function} [sortCriteria] Sort criteria function
 * @param {function} [sortFunction] Sort function
 *
 * @returns {Promise} that will be resolved with the metadata or rejected with the error
 */
export function retrieveStudyMetadata(
  dicomWebClient,
  StudyInstanceUID,
  enableStudyLazyLoad,
  filters,
  sortCriteria,
  sortFunction,
  dicomWebConfig = {}
) {
  // pacsai (Rev 11 milestone 6 part 2): a failed study or series retrieve no
  // longer stays cached for good (upstream's TODO here). It evicts its entry,
  // guarded by identity, so a return to the study retries it.

  if (!dicomWebClient) {
    throw new Error(`${moduleName}: Required 'dicomWebClient' parameter not provided.`);
  }
  if (!StudyInstanceUID) {
    throw new Error(`${moduleName}: Required 'StudyInstanceUID' parameter not provided.`);
  }

  const promiseId = promiseIdFor(StudyInstanceUID, dicomWebConfig);

  // Already waiting on result? Return cached promise
  if (StudyMetaDataPromises.has(promiseId)) {
    return StudyMetaDataPromises.get(promiseId);
  }

  let promise;

  if (filters && filters.seriesInstanceUID && Array.isArray(filters.seriesInstanceUID)) {
    promise = retrieveMetadataFiltered(
      dicomWebClient,
      StudyInstanceUID,
      enableStudyLazyLoad,
      filters,
      sortCriteria,
      sortFunction
    );
  } else {
    // Create a promise to handle the data retrieval
    promise = new Promise((resolve, reject) => {
      RetrieveMetadata(
        dicomWebClient,
        StudyInstanceUID,
        enableStudyLazyLoad,
        filters,
        sortCriteria,
        sortFunction
      ).then(function (data) {
        resolve(data);
      }, reject);
    });
  }

  // Only this entry: a late failure of an entry already replaced (deleted and
  // retrieved again) must not remove the newer one.
  const evict = () => {
    if (StudyMetaDataPromises.get(promiseId) === entry) {
      StudyMetaDataPromises.delete(promiseId);
    }
  };
  const entry = promise.then(
    data => {
      evictOnSeriesFailure(data, evict);
      return data;
    },
    error => {
      evict();
      throw error;
    }
  );

  // Store the promise in cache
  StudyMetaDataPromises.set(promiseId, entry);

  return entry;
}

/**
 * Delete the cached study metadata retrieval promise to ensure that the browser will
 * re-retrieve the study metadata when it is next requested.
 *
 * pacsai: by the key retrieveStudyMetadata writes, `${name}:${StudyInstanceUID}`.
 * Upstream deleted by the bare UID, which never matched an entry.
 *
 * @param {String} StudyInstanceUID The UID of the Study to be removed from cache
 * @param {Object} [dicomWebConfig] The data source's config (its `name` is half of the key)
 */
export function deleteStudyMetadataPromise(StudyInstanceUID, dicomWebConfig = {}) {
  const promiseId = promiseIdFor(StudyInstanceUID, dicomWebConfig);
  if (StudyMetaDataPromises.has(promiseId)) {
    StudyMetaDataPromises.delete(promiseId);
  }
}
