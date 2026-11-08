/**
 * Rev 11 milestone 7: the synthetic cases the hanging fixtures hang through
 * OHIF's own HangingProtocolService, shared by the sixteen protocols'
 * regression fixtures (hangingFixtures.test.ts) and PR 2's preset fixtures
 * (arrange/presetHanging.test.ts). Moved out of hangingFixtures.test.ts
 * without a change. Test support only: no viewer code imports it, and every
 * study, series and description is made up here.
 *
 * A test using it mocks '@ohif/core' as hangingFixtures.test.ts does.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- drives OHIF's untyped hanging internals */
import fs from 'fs';
import path from 'path';
import HangingProtocolService from '../../../../../platform/core/src/services/HangingProtocolService/HangingProtocolService';
import getHangingProtocolModule from '../../getHangingProtocolModule';
import getDefaultHangingProtocolModule from '../../../../default/src/getHangingProtocolModule';
import registerHangingAttributes from '../hangingAttributes';

const LONGITUDINAL_MODE = path.join(__dirname, '../../../../../modes/longitudinal/src/index.ts');

/** The protocol ids the reading modes offer, in the mode's order (radcopilot reuses longitudinal's). */
export function modeProtocolIds(): string[] {
  const src = fs.readFileSync(LONGITUDINAL_MODE, 'utf8');
  const m = src.match(/hangingProtocol:\s*\[([\s\S]*?)\]/);
  if (!m) {
    throw new Error('the longitudinal mode lists no hangingProtocol');
  }
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}

export type SeriesSpec = {
  /** SeriesDescription (carries the plane word, kernel and keywords the selectors read). */
  d: string;
  /** Number of images (default 60). */
  n?: number;
  /** ConvolutionKernel (CT). */
  k?: string;
  /** Modality (default the study's). */
  m?: string;
  /** PhotometricInterpretation (default MONOCHROME2). */
  p?: string;
  /** A time-resolved (4D) source. */
  dyn?: boolean;
  /** ImageType (default ORIGINAL\PRIMARY\AXIAL). */
  t?: string;
};
export type StudySpec = { desc: string; modality: string; series: SeriesSpec[]; date: string };

export type DS = Record<string, any>;
export type Study = Record<string, any>;

export function makeStudy(spec: StudySpec, tag: string): { study: Study; displaySets: DS[] } {
  const StudyInstanceUID = `9.9.study.${tag}`;
  const modalities = [...new Set([spec.modality, ...spec.series.map(s => s.m ?? spec.modality)])];
  const study: Study = {
    StudyInstanceUID,
    StudyDescription: spec.desc,
    ModalitiesInStudy: modalities.join('\\'),
    StudyDate: spec.date,
  };
  const displaySets = spec.series.map((s, i) => {
    const uid = `${StudyInstanceUID}.s${i + 1}`;
    const n = s.n ?? 60;
    const modality = s.m ?? spec.modality;
    const instance = {
      StudyInstanceUID,
      StudyDescription: spec.desc,
      SeriesDescription: s.d,
      Modality: modality,
      ConvolutionKernel: s.k,
      PhotometricInterpretation: s.p ?? 'MONOCHROME2',
      ImageType: (s.t ?? 'ORIGINAL\\PRIMARY\\AXIAL').split('\\'),
      SamplesPerPixel: s.p === 'RGB' ? 3 : 1,
    };
    return {
      StudyInstanceUID,
      SeriesInstanceUID: uid,
      displaySetInstanceUID: uid,
      Modality: modality,
      SeriesNumber: i + 1,
      SeriesDescription: s.d,
      SeriesDate: spec.date,
      numImageFrames: n,
      isDynamicVolume: !!s.dyn,
      images: Array.from({ length: Math.min(n, 3) }, () => instance),
      instances: Array.from({ length: Math.min(n, 3) }, () => instance),
      instance,
    } as DS;
  });
  return { study, displaySets };
}

/** The all-in-one composite loadRelevantPriors builds per loaded study (buildAllInOneDisplaySet). */
export function compositeOf(study: Study, displaySets: DS[]): DS | null {
  const sources = displaySets.filter(
    ds =>
      ds.Modality !== 'SR' &&
      ds.Modality !== 'US' &&
      !/topo|scout|bolus/i.test(ds.SeriesDescription)
  );
  if (sources.length < 2) {
    return null;
  }
  const uid = `${study.StudyInstanceUID}.allinone`;
  return {
    StudyInstanceUID: study.StudyInstanceUID,
    SeriesInstanceUID: uid,
    displaySetInstanceUID: uid,
    SeriesNumber: 99999,
    Modality: sources[0].Modality,
    SeriesDescription: `All-in-one (${sources.length} series)`,
    numImageFrames: sources.reduce((a, ds) => a + ds.numImageFrames, 0),
    isReconstructable: false,
    isAllInOne: true,
    images: sources[0].images,
    instances: sources[0].instances,
    instance: sources[0].instance,
  };
}

// ---- hanging through OHIF's own service ------------------------------------------

export function newService(activeDisplaySets: () => DS[]) {
  const hps = new HangingProtocolService({ run: jest.fn() } as never, { services: {} } as never);
  registerHangingAttributes({
    hangingProtocolService: hps as never,
    displaySetService: { getActiveDisplaySets: activeDisplaySets },
  });
  const all = new Map<string, any>();
  for (const { name, protocol } of getHangingProtocolModule()) {
    all.set(name, protocol);
  }
  for (const { name, protocol } of getDefaultHangingProtocolModule()) {
    if (!all.has(name)) {
      all.set(name, protocol);
    }
  }
  const ids = modeProtocolIds();
  for (const id of ids) {
    const protocol = all.get(id);
    if (!protocol) {
      throw new Error(`the mode lists ${id}, which no extension registers`);
    }
    hps.addProtocol(id, protocol);
  }
  hps.setActiveProtocolIds(ids);
  return hps;
}
