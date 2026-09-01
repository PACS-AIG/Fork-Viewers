import React from 'react';
import { getStudyRole } from '../priors/roleRegistry';
import { formatInterval, formatStudyDateTime } from './formatStudyDateTime';
import RoleTag from './RoleTag';
import PriorSwitcher from './PriorSwitcher';

/**
 * Viewport overlay tag that marks each pane's study ROLE so the reading
 * radiologist can tell — at a glance, on every viewport — which study is the one
 * they are dictating (the CURRENT / report target) versus a comparison PRIOR.
 * The danger this guards against is dictating or measuring on a prior by mistake.
 *
 *   CURRENT  -> green  "CURRENT · <date> <HH:mm>"
 *   PRIOR    -> amber  "PRIOR · <date> <HH:mm> · <interval>"  (interval = time before current)
 *
 * The clock time (StudyTime, 24h, appended by `formatStudyDateTime`) is what
 * separates two studies acquired on the SAME day — a same-day repeat or a
 * pre/post pair otherwise shows an identical tag on both panes. It degrades to
 * the date alone when the PACS omits StudyTime.
 *
 * The PRIOR pill is also the prior SWITCHER (`PriorSwitcher`): clicking it lists
 * the patient's other priors and re-hangs the protocol against the chosen one.
 *
 * Design notes:
 *  - The WORD carries the meaning, not the color alone (a meaningful share of
 *    radiologists are red/green color-deficient) — color is reinforcement.
 *  - GREEN is tied to the REPORT TARGET, not the focused pane: `getStudyRole`
 *    derives `current` from the hanging protocol's activeStudyUID (the hung/report
 *    study), which does NOT change when the user clicks into a prior pane to
 *    scroll it. "Which pane has focus" is the separate cyan active-viewport
 *    border; study role and focus stay orthogonal.
 *  - Amber (not red) for priors: red stays reserved for true alerts (STAT,
 *    critical findings) so it keeps its meaning.
 *  - SIBLINGS (same-session concurrent exams, e.g. whole-spine C/T/L) are NOT
 *    tagged — they are part of the current reading session, not temporal priors,
 *    and must not be mislabeled "PRIOR".
 *
 * Registered into `viewportOverlay.topRight` (see the longitudinal mode). The
 * overlay framework only passes `servicesManager`/`displaySet` to `contentF`
 * (not to `condition`), so the role check lives in `contentF`, returning null
 * otherwise.
 */
export const STUDY_ROLE_OVERLAY_ITEM_ID = 'pacsai-study-role-indicator';

// Tailwind-ish emerald-400 / amber-400 — bright enough to read over either a
// dark background or bright (e.g. CR) pixels.
const CURRENT_COLOR = '#34D399';
const PRIOR_COLOR = '#FBBF24';

/**
 * Find the CURRENT (report-target) study's timestamp from the loaded display
 * sets, as a `{ StudyDate, StudyTime }` source for `formatStudyDateTime` (the
 * prior interval also needs the raw date, so this returns both parts, not a
 * formatted string).
 */
function getCurrentStudyStamp(
  servicesManager: any,
  activeStudyUID?: string
): { StudyDate?: string; StudyTime?: string } | undefined {
  if (!activeStudyUID) {
    return undefined;
  }
  const displaySets = servicesManager?.services?.displaySetService?.getActiveDisplaySets?.() ?? [];
  const curDs = displaySets.find((d: any) => d?.StudyInstanceUID === activeStudyUID);
  if (!curDs) {
    return undefined;
  }
  const instance = curDs.instances?.[0];
  return {
    StudyDate: instance?.StudyDate ?? curDs.SeriesDate,
    StudyTime: instance?.StudyTime ?? curDs.SeriesTime,
  };
}

export const studyRoleOverlayItem = {
  id: STUDY_ROLE_OVERLAY_ITEM_ID,
  title: 'Study role indicator (current / prior)',
  contentF: (props: Record<string, any>) => {
    const { displaySet, servicesManager, formatters } = props ?? {};
    if (!displaySet) {
      return null;
    }

    const activeStudyUID =
      servicesManager?.services?.hangingProtocolService?.getState?.()?.activeStudyUID;
    const role = getStudyRole(displaySet.StudyInstanceUID, activeStudyUID);

    // Only the report target (current) and temporal priors are tagged; siblings
    // (same-session) are intentionally left unmarked.
    if (role !== 'current' && role !== 'prior') {
      return null;
    }

    const currentStamp = getCurrentStudyStamp(servicesManager, activeStudyUID);

    if (role === 'current') {
      const stamp = formatStudyDateTime(currentStamp, formatters?.formatDate);
      return <RoleTag color={CURRENT_COLOR} label={stamp ? `CURRENT · ${stamp}` : 'CURRENT'} />;
    }

    // role === 'prior'
    const priorStamp = {
      StudyDate: displaySet.instances?.[0]?.StudyDate ?? displaySet.SeriesDate,
      StudyTime: displaySet.instances?.[0]?.StudyTime ?? displaySet.SeriesTime,
    };
    const stamp = formatStudyDateTime(priorStamp, formatters?.formatDate);
    const interval = formatInterval(currentStamp?.StudyDate, priorStamp.StudyDate);
    const label = ['PRIOR', stamp, interval].filter(Boolean).join(' · ');
    // The prior pill is a switcher: clicking it offers the patient's other priors
    // and re-hangs against the chosen one. Degrades to a static pill when there is
    // no alternative to offer.
    return (
      <PriorSwitcher
        color={PRIOR_COLOR}
        label={label}
        priorUID={displaySet.StudyInstanceUID}
        currentDate={currentStamp?.StudyDate}
        formatDate={formatters?.formatDate}
      />
    );
  },
};

export default studyRoleOverlayItem;
