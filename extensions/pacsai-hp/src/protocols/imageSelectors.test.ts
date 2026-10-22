/**
 * 22 Oct (prod): an X-ray study of two chest views and a Basic Text SR showed
 * nothing at all. @pacsai/compareCR's image selector has no required plane, so the
 * SR passed it as a third "view": the 3-tile stage hung it, its viewport threw on a
 * report text sent as a bulk data reference, and the whole route went down. The
 * compare protocols' image selectors now require `pacsaiImage === 'image'`
 * (index.tsx, from allinone/buildAllInOneDisplaySet's isNonImageDisplaySet).
 * Driven through OHIF's own HangingProtocolService.
 */
jest.mock('@ohif/core', () => ({ classes: {} }));

// eslint-disable-next-line import/first
import HangingProtocolService from '../../../../platform/core/src/services/HangingProtocolService/HangingProtocolService';
// eslint-disable-next-line import/first
import getHangingProtocolModule from '../getHangingProtocolModule';
// eslint-disable-next-line import/first
import hpCompareCR from './hpCompareCR';
// eslint-disable-next-line import/first
import { isNonImageDisplaySet } from '../allinone/buildAllInOneDisplaySet';
// eslint-disable-next-line import/first
import logPlannedStages from '../priors/debugPlannedStages';

const STUDY = '1.2.3';
const study = { StudyInstanceUID: STUDY, ModalitiesInStudy: 'CR\\SR' };
const view = (series: number) => ({
  StudyInstanceUID: STUDY,
  SeriesInstanceUID: `cr-${series}`,
  displaySetInstanceUID: `cr-${series}`,
  Modality: 'CR',
  SeriesNumber: series,
  SeriesDescription: 'CHEST AP',
  numImageFrames: 1,
  images: [{}],
  instances: [{}],
});
const report = {
  StudyInstanceUID: STUDY,
  SeriesInstanceUID: 'sr-999',
  displaySetInstanceUID: 'sr-999',
  Modality: 'SR',
  SeriesNumber: 999,
  SeriesDescription: 'Report',
  instances: [{}],
};

type DS = Record<string, unknown>;
const isImage = (ds: DS) => (isNonImageDisplaySet(ds) ? 'nonimage' : 'image');

/** The stage compareCR applies to these display sets, and what it hangs. */
function hang(displaySets: DS[], image: (ds: DS) => string = isImage) {
  const hps = new HangingProtocolService({ run: jest.fn() } as never, { services: {} } as never);
  hps.addCustomAttribute('pacsaiRole', 'role', (ds: DS) =>
    ds.StudyInstanceUID === STUDY ? 'current' : undefined
  );
  hps.addCustomAttribute('pacsaiAllInOne', 'all-in-one', (ds: DS) =>
    ds.isAllInOne ? 'allinone' : 'series'
  );
  hps.addCustomAttribute('pacsaiImage', 'image', image);
  hps.addProtocol(hpCompareCR.id, hpCompareCR);
  hps.run({ studies: [study], activeStudy: study, displaySets } as never, hpCompareCR.id);
  const { protocol, stageIndex } = hps.getActiveProtocol();
  const hung = [...hps.getMatchDetails().viewportMatchDetails.values()].flatMap(v =>
    v.displaySetsInfo.map(info => info.displaySetInstanceUID)
  );
  return { stage: protocol.stages[stageIndex].id, hung };
}

describe('the compare protocols hang images only', () => {
  it('two chest views and a text report: the two views tiled, the report not', () => {
    expect(hang([view(1), view(4), report])).toEqual({
      stage: 'current-tile-2',
      hung: ['cr-1', 'cr-4'],
    });
  });

  it('as before the fix (every series an image to the matcher): the report hung as a third view', () => {
    const before = hang([view(1), view(4), report], () => 'image');
    expect(before.stage).toBe('current-tile-3');
    expect(before.hung).toContain('sr-999');
  });

  it('a study of only a report still shows it (the last-resort selector only prefers images)', () => {
    expect(hang([report])).toEqual({ stage: 'current-any', hung: ['sr-999'] });
  });

  it('every image selector of every compare protocol requires an image; the last resort prefers one', () => {
    type Rule = {
      attribute: string;
      required?: boolean;
      constraint?: { equals?: { value?: unknown } };
    };
    const imageRule = { attribute: 'pacsaiImage', constraint: { equals: { value: 'image' } } };
    const missing: string[] = [];
    getHangingProtocolModule().forEach(({ protocol }) => {
      Object.entries(protocol.displaySetSelectors ?? {}).forEach(
        ([id, selector]: [string, { seriesMatchingRules?: Rule[] }]) => {
          const rules = selector.seriesMatchingRules ?? [];
          const image = rules.find(rule => rule.attribute === 'pacsaiImage');
          const imagePane = rules.some(
            rule =>
              rule.attribute === 'pacsaiAllInOne' &&
              rule.required &&
              rule.constraint?.equals?.value === 'series'
          );
          if (id === 'anyCurrent') {
            if (!image || image.required || image.constraint?.equals?.value !== 'image') {
              missing.push(`${protocol.id} ${id} (soft)`);
            }
          } else if (imagePane && !(image && image.required)) {
            missing.push(`${protocol.id} ${id}`);
          }
        }
      );
    });
    expect(missing).toEqual([]);
    expect(hpCompareCR.displaySetSelectors['current-img'].seriesMatchingRules).toContainEqual(
      expect.objectContaining({ ...imageRule, required: true })
    );
  });

  it('the planned-stage log (its replay of the matcher) agrees: 3 tiles disabled, 2 enabled', () => {
    const lines: string[] = [];
    logPlannedStages(hpCompareCR, [view(1), view(4), report], STUDY, (...args) =>
      lines.push(args.join(' '))
    );
    expect(lines.find(l => l.includes('current-tile-3'))).toMatch(/2\/3 vp matched.*=> disabled/);
    expect(lines.find(l => l.includes('current-tile-2'))).toMatch(/2\/2 vp matched.*=> ENABLED/);
  });

  it('what counts as a non-image series', () => {
    expect(
      ['SR', 'KO', 'PR', 'SEG', 'RTSTRUCT', 'DOC'].map(Modality =>
        isNonImageDisplaySet({ Modality })
      )
    ).toEqual([true, true, true, true, true, true]);
    expect(
      ['CR', 'DX', 'CT', 'MR', 'US', 'OT'].map(Modality => isNonImageDisplaySet({ Modality }))
    ).toEqual([false, false, false, false, false, false]);
    expect(isNonImageDisplaySet({ Modality: 'CT', isDerivedDisplaySet: true })).toBe(true);
    expect(isNonImageDisplaySet({ Modality: 'MR', isOverlayDisplaySet: true })).toBe(true);
  });
});
