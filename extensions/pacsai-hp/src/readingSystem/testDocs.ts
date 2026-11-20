/**
 * RS-36: contract-shaped documents for the reading-system pane's unit tests,
 * written here (made-up wording and ids, no DICOM UIDs); nothing is copied
 * from the reading system's own fixtures. Only the tests import this file.
 */
import type {
  RsEvidenceView,
  RsInbox,
  RsReport,
  RsSnapshotDocument,
  RsVersions,
} from './rsContract';

export const STUDY = 'study-under-test';
export const CONTRACT = 'pacsai.reading/1.12';
const envelope = (artifact: string, snapshotId = 'fx-test') => ({
  contractVersion: CONTRACT,
  artifact,
  snapshotId,
  studyUID: STUDY,
  bundleHash: 'b'.repeat(64),
  mode: 'fixture' as const,
});

export function makeReport(over: Partial<RsReport> = {}): RsReport {
  return {
    ...envelope('report'),
    artifact: 'report',
    snapshotId: 'fx-test',
    studyUID: STUDY,
    version: 'published',
    revision: 4,
    epoch: 1,
    protocol: 'ct_abdomen_pelvis',
    sections: {
      meta: [
        { id: 'indication', title: 'Indication', passageIds: ['p-ind'] },
        { id: 'comparison', title: 'Comparison', passageIds: ['p-comp'] },
      ],
      findings: [
        { id: 'liver_and_biliary', title: 'Liver and biliary', passageIds: ['p-liver'] },
        { id: 'spleen', title: 'Spleen', passageIds: [] },
        { id: 'kidneys_and_ureters', title: 'Kidneys and ureters', passageIds: ['p-kidney'] },
      ],
      impression: { id: 'impression', title: 'Impression', passageIds: ['p-imp'] },
    },
    passages: [
      {
        id: 'p-ind',
        section: 'indication',
        owner: 'machine',
        text: 'Abdominal pain.',
        sentenceIds: [],
        boundEntries: [],
      },
      {
        id: 'p-comp',
        section: 'comparison',
        owner: 'machine',
        text: 'None.',
        sentenceIds: [],
        boundEntries: [],
      },
      {
        id: 'p-liver',
        section: 'liver_and_biliary',
        owner: 'machine',
        text: '12 mm low-attenuation lesion in the liver.',
        sentenceIds: ['s-liver'],
        boundEntries: ['F1'],
      },
      {
        id: 'p-kidney',
        section: 'kidneys_and_ureters',
        owner: 'clinician',
        text: 'Small cyst in the left kidney.',
        sentenceIds: ['s-kidney'],
        boundEntries: ['F2'],
      },
      {
        id: 'p-imp',
        section: 'impression',
        owner: 'machine',
        text: '12 mm liver lesion.',
        sentenceIds: ['s-liver'],
        boundEntries: ['F1'],
      },
    ],
    chrome: {
      pending: { sections: [], tasks: [], withheld: [] },
      comparison: { state: 'complete', label: null, unlinked: [] },
      impression: { complete: true, sound: true, style: 'unavailable', withheld: [], failures: [] },
      phase: { flagged: [] },
    },
    text: 'Indication: Abdominal pain.',
    ...over,
  };
}

export function makeVersions(over: Partial<RsVersions> = {}): RsVersions {
  return {
    ...envelope('versions'),
    artifact: 'versions',
    opened: false,
    signed: false,
    published: { revision: 4, epoch: 1, snapshotId: 'fx-test' },
    latest: { revision: 4, epoch: 1, snapshotId: 'fx-test' },
    revisions: [],
    pendingUpdates: [],
    patches: [],
    ...over,
  };
}

export function makeInbox(over: Partial<RsInbox> = {}): RsInbox {
  return {
    ...envelope('inbox'),
    artifact: 'inbox',
    entries: [],
    rejected: [],
    changeList: { added: [], changed: [], deleted: [], sidesChanged: [] },
    ...over,
  };
}

export const UPDATE_ENTRY = {
  id: 'inbox-1',
  kind: 'update' as const,
  entryIds: ['F1'],
  updates: ['update-1'],
  claims: [
    {
      entryId: 'F1',
      property: 'measurement' as const,
      before: { value: 12, units: 'mm' },
      after: { value: 14, units: 'mm' },
    },
  ],
  summary: 'diameter 12 -> 14 mm',
  preview: [
    {
      passageId: 'p-liver',
      section: 'liver_and_biliary',
      before: '12 mm low-attenuation lesion in the liver.',
      after: '14 mm low-attenuation lesion in the liver.',
      ownerBefore: 'machine',
      ownerAfter: 'machine',
    },
    {
      passageId: 'p-imp',
      section: 'impression',
      before: '12 mm liver lesion.',
      after: '14 mm liver lesion.',
      ownerBefore: 'machine',
      ownerAfter: 'machine',
    },
  ],
  patches: [],
  acceptable: true,
  reason: null,
};

export function makeEvidence(over: Partial<RsEvidenceView> = {}): RsEvidenceView {
  return {
    ...envelope('evidence_view'),
    artifact: 'evidence_view',
    findings: [
      {
        entryId: 'F1',
        sentenceId: 's-liver',
        kind: 'measured',
        section: 'liver_and_biliary',
        tier: 'reportable',
        critical: false,
        sources: [
          { type: 'lesion_task', producer: 'test:lesions', classHypothesis: 'hypodense_lesion' },
          {
            type: 'detector',
            producer: 'test:detector',
            classHypothesis: 'solid mass',
            score: 0.7,
          },
        ],
        disagreement: [{ source: 'test:detector', classHypothesis: 'solid mass' }],
        canonical: {
          kind: 'mask_from_stress_policy_base',
          value: 12.2,
          display: 12,
          units: 'mm',
          range: [11.8, 12.6],
          recipeId: 'segmenter@test',
          statistic: 'ROI median',
          hu: 18.4,
          huDisplay: 18,
          phase: 'portal_venous',
        },
        classState: 'unresolved',
        className: null,
        branches: {
          pathway_a: { state: 'unresolved', unresolved: ['well_defined'] },
          pathway_b: { state: 'unresolved', reason: 'threshold_null' },
        },
        unresolvedPredicates: ['well_defined'],
        comparison: {
          form: 'paired_measurements',
          rendered: true,
          priorValue_mm: 10,
          priorDate: '2025-01-02',
          currentValue_mm: 12,
        },
        classAlternatives: [
          {
            className: 'Class II',
            detectorClass: 'c2',
            proposalId: 'cmd-1',
            reportedAs: 'reportable',
            model: 'model@test',
            score: 0.6,
          },
        ],
        questions: [
          { order: 2, kind: 'unresolved_predicate', predicate: 'thin_wall' },
          { order: 1, kind: 'unresolved_predicate', predicate: 'well_defined' },
        ],
        signing: {
          requiresAcknowledgementAgainstDisplayedRevision: true,
          requiresDisposition: false,
        },
      },
    ],
    study: {
      processingPanel: [
        {
          region: 'peritoneal_cavity',
          methodFamily: 'physics',
          adequate: true,
          text: 'peritoneal cavity assessed',
        },
      ],
    },
    ...over,
  };
}

export function makeSnapshot(patientKey = 'patient-key-under-test'): RsSnapshotDocument {
  return { ...envelope('snapshot'), artifact: 'snapshot', snapshot: { patientKey } };
}
