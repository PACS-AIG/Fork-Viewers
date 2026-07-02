import React, { useCallback, useEffect, useReducer, useState } from 'react';
import { Enums } from '@cornerstonejs/core';
import { PanelSection, Icons } from '@ohif/ui-next';
import {
  parseDicomAge,
  deriveAgeFromDob,
} from '../overlays/clinicalContextOverlayItem';
import {
  requestClinicalIndication,
  subscribeClinicalContext,
} from '../clinicalContext/clinicalContextStore';
import { getImagePlane } from '../utils/getImagePlane';
import { getImageKernelInfo } from '../utils/getImageKernel';

/**
 * Study Info drawer (right panel): patient / study / series / current image /
 * documents / advanced, for the ACTIVE viewport's study & series. Fixes the
 * "age and study details don't display" complaint — everything renders from
 * displaySet/instance metadata (plus the PACS-AI API indication cache), with
 * the same strict age rules as the on-image overlay (PatientAge, else
 * DOB+StudyDate, else "Unavailable" — never today's date, never a guess).
 *
 * Missing fields are omitted (age excepted). UIDs and IDs get copy buttons.
 * Document series (DOC/SR/KO/PR/SC/OT) are listed with an open-in-active-
 * viewport action (same getViewportsRequireUpdate path as thumbnail
 * double-click). Advanced holds the UIDs, transfer syntax and the DICOM tag
 * browser. No PHI leaves the panel — copy goes to the user's clipboard only.
 */

const DOCUMENT_MODALITIES = new Set(['DOC', 'SR', 'KO', 'PR', 'SC', 'OT']);

const fmtDate = (raw?: string): string | undefined => {
  const m = typeof raw === 'string' ? raw.match(/^(\d{4})(\d{2})(\d{2})/) : null;
  if (!m) {
    return undefined;
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime())
    ? undefined
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const fmtTime = (raw?: string): string | undefined => {
  const m = typeof raw === 'string' ? raw.match(/^(\d{2})(\d{2})(\d{2})?/) : null;
  return m ? `${m[1]}:${m[2]}${m[3] ? `:${m[3]}` : ''}` : undefined;
};

/** DICOM PN → display string; handles both raw "A^B^C" and { Alphabetic }. */
const fmtPN = (pn: unknown): string | undefined => {
  const raw =
    typeof pn === 'string' ? pn : (pn as any)?.Alphabetic ?? (Array.isArray(pn) ? pn[0] : undefined);
  const s = typeof raw === 'string' ? raw.replace(/\^+/g, ' ').trim() : undefined;
  return s || undefined;
};

const str = (v: unknown): string | undefined => {
  const raw = Array.isArray(v) ? v.join(', ') : v;
  if (raw === null || raw === undefined) {
    return undefined;
  }
  const s = String(raw).trim();
  return s.length ? s : undefined;
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="ml-1 shrink-0 rounded p-0.5 text-white/40 hover:bg-white/10 hover:text-white"
      title="Copy"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? (
        <span className="text-[11px] leading-none text-green-400">✓</span>
      ) : (
        <Icons.ByName
          name="Copy"
          className="h-3.5 w-3.5"
        />
      )}
    </button>
  );
}

function Row({
  label,
  value,
  copyable,
  mono,
}: {
  label: string;
  value?: string;
  copyable?: boolean;
  mono?: boolean;
}) {
  if (!value) {
    return null;
  }
  return (
    <div className="flex items-start justify-between gap-2 px-2.5 py-[3px]">
      <span className="shrink-0 text-[12px] leading-[18px] text-white/50">{label}</span>
      <span
        className={`flex min-w-0 items-center text-right text-[12px] leading-[18px] text-white/90 ${
          mono ? 'break-all font-mono text-[11px]' : ''
        }`}
      >
        <span className="min-w-0 select-text">{value}</span>
        {copyable ? <CopyButton text={value} /> : null}
      </span>
    </div>
  );
}

function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <PanelSection defaultOpen={defaultOpen}>
      <PanelSection.Header>{title}</PanelSection.Header>
      <PanelSection.Content>
        <div className="py-1">{children}</div>
      </PanelSection.Content>
    </PanelSection>
  );
}

export default function PanelStudyInfo({ servicesManager, commandsManager }: any) {
  const {
    viewportGridService,
    displaySetService,
    cornerstoneViewportService,
    hangingProtocolService,
    uiNotificationService,
  } = servicesManager.services;

  const [renderTick, forceRender] = useReducer((x: number) => x + 1, 0);

  // Re-render on: active viewport / layout changes, displaySets arriving
  // (priors stream in late), indication fetch resolving, and slice scroll
  // (current-image section). The scroll listener attaches to the active
  // viewport's element and re-attaches when the active viewport changes.
  useEffect(() => {
    const subs = [
      viewportGridService.subscribe(
        viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
        forceRender
      ),
      viewportGridService.subscribe(viewportGridService.EVENTS.GRID_STATE_CHANGED, forceRender),
      displaySetService.subscribe(displaySetService.EVENTS.DISPLAY_SETS_ADDED, forceRender),
    ];
    const unsubscribeStore = subscribeClinicalContext(forceRender);
    return () => {
      subs.forEach(sub => sub?.unsubscribe?.());
      unsubscribeStore();
    };
  }, [viewportGridService, displaySetService]);

  const activeViewportId = viewportGridService.getActiveViewportId?.();

  useEffect(() => {
    if (!activeViewportId) {
      return;
    }
    let element: HTMLElement | undefined;
    try {
      element = cornerstoneViewportService.getCornerstoneViewport?.(activeViewportId)?.element;
    } catch {
      /* viewport not enabled yet */
    }
    if (!element) {
      return;
    }
    const onNewImage = () => forceRender();
    element.addEventListener(Enums.Events.STACK_NEW_IMAGE, onNewImage);
    element.addEventListener(Enums.Events.VOLUME_NEW_IMAGE, onNewImage);
    return () => {
      element.removeEventListener(Enums.Events.STACK_NEW_IMAGE, onNewImage);
      element.removeEventListener(Enums.Events.VOLUME_NEW_IMAGE, onNewImage);
    };
    // renderTick: the element may not exist on first render (viewport not yet
    // enabled) — re-attaching on every forced re-render guarantees we
    // eventually bind once the viewport is live. Cheap add/remove.
  }, [activeViewportId, cornerstoneViewportService, renderTick]);

  const uids: string[] =
    (activeViewportId &&
      viewportGridService.getDisplaySetsUIDsForViewport?.(activeViewportId)) ||
    [];
  const displaySet = uids.map(uid => displaySetService.getDisplaySetByUID(uid)).find(Boolean);

  const openDocument = useCallback(
    (displaySetInstanceUID: string) => {
      try {
        const updated = hangingProtocolService.getViewportsRequireUpdate(
          viewportGridService.getActiveViewportId(),
          displaySetInstanceUID,
          true
        );
        viewportGridService.setDisplaySetsForViewports(updated);
      } catch (error) {
        uiNotificationService?.show?.({
          title: 'Study Info',
          message: 'This document could not be opened in the active viewport.',
          type: 'error',
          duration: 3000,
        });
      }
    },
    [hangingProtocolService, viewportGridService, uiNotificationService]
  );

  if (!displaySet) {
    return (
      <div className="p-3 text-[12px] text-white/50">No series in the active viewport.</div>
    );
  }

  const ref = displaySet.instances?.[0] ?? displaySet.instance ?? {};
  const studyUID = displaySet.StudyInstanceUID;

  // Current image: resolve the active viewport's current imageId back to its
  // instance; falls back to the first instance (e.g. before first render).
  let currentInstance = ref;
  try {
    const csViewport = cornerstoneViewportService.getCornerstoneViewport?.(activeViewportId);
    const currentImageId = csViewport?.getCurrentImageId?.();
    if (currentImageId) {
      const found = (displaySet.images ?? displaySet.instances ?? []).find(
        (i: any) => i?.imageId === currentImageId
      );
      if (found) {
        currentInstance = found;
      }
    }
  } catch {
    /* keep reference instance */
  }

  // Strict age: PatientAge → DOB+StudyDate → "Unavailable".
  const age =
    parseDicomAge(ref.PatientAge) ??
    deriveAgeFromDob(ref.PatientBirthDate, ref.StudyDate) ??
    'Unavailable';

  // Study-level: aggregate across the study's loaded displaySets.
  const studyDisplaySets = displaySetService
    .getActiveDisplaySets()
    .filter((ds: any) => ds.StudyInstanceUID === studyUID && !ds.isAllInOne);
  const modalities = [...new Set(studyDisplaySets.map((ds: any) => ds.Modality).filter(Boolean))].join(
    ', '
  );
  const documents = studyDisplaySets.filter((ds: any) => DOCUMENT_MODALITIES.has(ds.Modality));

  const indication = requestClinicalIndication(studyUID, servicesManager)?.indication ?? undefined;

  const kernelInfo = getImageKernelInfo(displaySet);
  const plane = getImagePlane(displaySet);

  return (
    <div className="flex flex-col overflow-y-auto px-1 pb-4">
      <Section title="Patient">
        <Row
          label="Name"
          value={fmtPN(ref.PatientName)}
        />
        <Row
          label="MRN"
          value={str(ref.PatientID)}
          copyable
        />
        <Row
          label="Date of birth"
          value={fmtDate(ref.PatientBirthDate)}
        />
        <Row
          label="Age at study"
          value={age}
        />
        <Row
          label="Sex"
          value={str(ref.PatientSex)}
        />
      </Section>

      <Section title="Study">
        <Row
          label="Accession"
          value={str(ref.AccessionNumber)}
          copyable
        />
        <Row
          label="Date"
          value={fmtDate(ref.StudyDate)}
        />
        <Row
          label="Time"
          value={fmtTime(ref.StudyTime)}
        />
        <Row
          label="Description"
          value={str(ref.StudyDescription)}
        />
        <Row
          label="Indication"
          value={str(indication)}
        />
        <Row
          label="Modalities"
          value={modalities}
        />
        <Row
          label="Referring"
          value={fmtPN(ref.ReferringPhysicianName)}
        />
        <Row
          label="Institution"
          value={str(ref.InstitutionName)}
        />
        <Row
          label="Department"
          value={str(ref.InstitutionalDepartmentName)}
        />
        <Row
          label="Performing"
          value={fmtPN(ref.PerformingPhysicianName)}
        />
      </Section>

      <Section title="Series (active viewport)">
        <Row
          label="Description"
          value={str(displaySet.SeriesDescription)}
        />
        <Row
          label="Series #"
          value={str(displaySet.SeriesNumber)}
        />
        <Row
          label="Modality"
          value={str(displaySet.Modality)}
        />
        <Row
          label="Body part"
          value={str(ref.BodyPartExamined)}
        />
        <Row
          label="Laterality"
          value={str(ref.Laterality ?? ref.ImageLaterality)}
        />
        <Row
          label="Orientation"
          value={plane ? plane.toUpperCase() : undefined}
        />
        <Row
          label="Slice thickness"
          value={ref.SliceThickness ? `${Number(ref.SliceThickness).toFixed(1)} mm` : undefined}
        />
        <Row
          label="Kernel"
          value={str(kernelInfo?.convKernel)}
        />
        <Row
          label="Contrast"
          value={str(ref.ContrastBolusAgent)}
        />
        <Row
          label="Images"
          value={str(displaySet.numImageFrames ?? displaySet.images?.length)}
        />
      </Section>

      <Section title="Current image">
        <Row
          label="Instance #"
          value={str(currentInstance.InstanceNumber)}
        />
        <Row
          label="Acquired"
          value={
            [fmtDate(currentInstance.AcquisitionDate), fmtTime(currentInstance.AcquisitionTime)]
              .filter(Boolean)
              .join(' ') || undefined
          }
        />
        <Row
          label="Slice location"
          value={
            currentInstance.SliceLocation !== undefined && currentInstance.SliceLocation !== null
              ? `${Number(currentInstance.SliceLocation).toFixed(1)} mm`
              : undefined
          }
        />
        <Row
          label="View position"
          value={str(currentInstance.ViewPosition)}
        />
      </Section>

      {documents.length > 0 && (
        <Section title={`Documents (${documents.length})`}>
          {documents.map((ds: any) => (
            <button
              key={ds.displaySetInstanceUID}
              className="flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left hover:bg-white/5"
              title="Open in the active viewport"
              onClick={() => openDocument(ds.displaySetInstanceUID)}
            >
              <span className="min-w-0 truncate text-[12px] text-white/90">
                {str(ds.SeriesDescription) ?? ds.Modality}
              </span>
              <span className="shrink-0 text-[11px] text-white/50">
                {[ds.Modality, fmtDate(ds.instances?.[0]?.SeriesDate ?? ds.SeriesDate)]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
          ))}
        </Section>
      )}

      <Section
        title="Advanced"
        defaultOpen={false}
      >
        <Row
          label="StudyInstanceUID"
          value={str(studyUID)}
          copyable
          mono
        />
        <Row
          label="SeriesInstanceUID"
          value={str(displaySet.SeriesInstanceUID)}
          copyable
          mono
        />
        <Row
          label="SOPInstanceUID"
          value={str(currentInstance.SOPInstanceUID)}
          copyable
          mono
        />
        <Row
          label="Transfer syntax"
          value={str(ref.TransferSyntaxUID ?? displaySet.TransferSyntaxUID)}
          mono
        />
        <div className="px-2.5 pt-2">
          <button
            className="w-full rounded border border-white/20 py-1 text-[12px] text-white/80 hover:bg-white/10"
            onClick={() =>
              commandsManager.runCommand('openDICOMTagViewer', {
                displaySetInstanceUID: displaySet.displaySetInstanceUID,
              })
            }
          >
            Open DICOM Tag Browser
          </button>
        </div>
      </Section>
    </div>
  );
}
