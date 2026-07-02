import React, { useCallback, useEffect, useReducer } from 'react';
import { utils } from '@ohif/core';
import { Icons } from '@ohif/ui-next';

const { formatPN, formatDate, parseDicomAge, deriveAgeFromDob } = utils;

export enum PatientInfoVisibility {
  VISIBLE = 'visible',
  VISIBLE_COLLAPSED = 'visibleCollapsed',
  DISABLED = 'disabled',
  VISIBLE_READONLY = 'visibleReadOnly',
}

/**
 * Top-bar patient/study chip:
 *
 *   REYES, DOROTHY L · 61Y F · Acc 12345
 *   CT Abdomen/Pelvis · Jun 29, 2026 · 512 images
 *
 * Describes the ACTIVE (report-target) study — hangingProtocolService's
 * activeStudyUID, same source of truth as the CURRENT/PRIOR viewport tags —
 * not whichever displaySet happened to load first, and it follows session-study
 * switches. Age is strict (PatientAge, else DOB+StudyDate, else omitted;
 * never today's date). Missing fields drop out cleanly — no "undefined", no
 * dangling separators. Click opens the Study Info drawer (right panel).
 * Mixed-patient sessions show an explicit warning chip instead of one
 * patient's demographics.
 */

/** Right-panel id of the Study Info drawer (pacsai-hp); plain string, no import cycle. */
const STUDY_INFO_PANEL_ID = '@ohif/extension-pacsai-hp.panelModule.studyInfo';

const dot = ' · ';

function getChipInfo(servicesManager: AppTypes.ServicesManager) {
  const { displaySetService, hangingProtocolService } = servicesManager.services;
  const displaySets = displaySetService
    .getActiveDisplaySets()
    .filter((ds: any) => !ds.isAllInOne);
  if (!displaySets.length) {
    return null;
  }

  const activeStudyUID =
    hangingProtocolService.getState?.()?.activeStudyUID ?? displaySets[0].StudyInstanceUID;
  const studySets = displaySets.filter((ds: any) => ds.StudyInstanceUID === activeStudyUID);
  const sets = studySets.length ? studySets : displaySets;

  const ref = sets[0]?.instances?.[0] ?? sets[0]?.instance ?? {};
  const mixedPatients = displaySets.some((ds: any) => {
    const instance = ds?.instances?.[0] ?? ds?.instance;
    return instance && instance.PatientID !== ref.PatientID;
  });

  const imageCount = sets.reduce(
    (sum: number, ds: any) => sum + (Number(ds.numImageFrames ?? ds.images?.length) || 0),
    0
  );

  return {
    mixedPatients,
    name: ref.PatientName ? formatPN(ref.PatientName) : undefined,
    ageSex: [
      parseDicomAge(ref.PatientAge) ?? deriveAgeFromDob(ref.PatientBirthDate, ref.StudyDate),
      typeof ref.PatientSex === 'string' ? ref.PatientSex.trim().toUpperCase() : undefined,
    ]
      .filter(Boolean)
      .join(' '),
    accession: ref.AccessionNumber ? `Acc ${ref.AccessionNumber}` : undefined,
    description: typeof ref.StudyDescription === 'string' ? ref.StudyDescription.trim() : undefined,
    date: ref.StudyDate ? formatDate(ref.StudyDate) : undefined,
    imageCount: imageCount > 0 ? `${imageCount} images` : undefined,
  };
}

function HeaderPatientInfo({ servicesManager, appConfig }: withAppTypes) {
  const { displaySetService, hangingProtocolService, panelService } = servicesManager.services;
  const [, forceRender] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const subs = [
      displaySetService.subscribe(displaySetService.EVENTS.DISPLAY_SETS_ADDED, forceRender),
      hangingProtocolService.subscribe(
        hangingProtocolService.EVENTS.PROTOCOL_CHANGED,
        forceRender
      ),
    ];
    return () => subs.forEach(sub => sub?.unsubscribe?.());
  }, [displaySetService, hangingProtocolService]);

  const openStudyInfo = useCallback(() => {
    // No-op when the Study Info panel isn't registered (non-longitudinal modes).
    panelService?.activatePanel?.(STUDY_INFO_PANEL_ID, true);
  }, [panelService]);

  const info = getChipInfo(servicesManager);
  if (!info) {
    return null;
  }

  if (info.mixedPatients) {
    return (
      <div className="flex items-center gap-1 rounded-lg px-2">
        <Icons.MultiplePatients className="text-primary-active" />
        <span className="text-[13px] text-white">Multiple patients loaded</span>
      </div>
    );
  }

  const line1 = [info.name, info.ageSex, info.accession].filter(Boolean).join(dot);
  const line2 = [info.description, info.date, info.imageCount].filter(Boolean).join(dot);

  return (
    <div
      // max-w keeps a long name/description from starving the toolbar zone —
      // both text lines truncate; full values live in the Study Info drawer.
      className="hover:bg-primary-dark flex max-w-[380px] cursor-pointer items-center gap-2 rounded-lg px-2 py-0.5"
      onClick={openStudyInfo}
      title="Open Study Info"
      data-cy="header-study-chip"
    >
      <Icons.Patient className="text-primary-active shrink-0" />
      <div className="flex min-w-0 flex-col justify-center">
        <div className="truncate text-[13px] font-bold leading-[17px] text-white">
          {line1 || 'Patient details unavailable'}
        </div>
        {line2 ? (
          <div className="text-aqua-pale truncate text-[11px] leading-[15px]">{line2}</div>
        ) : null}
      </div>
    </div>
  );
}

export default HeaderPatientInfo;
