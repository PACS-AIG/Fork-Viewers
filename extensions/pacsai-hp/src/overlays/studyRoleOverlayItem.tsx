import React from 'react';
import { getStudyRole } from '../priors/roleRegistry';

/**
 * Viewport overlay tag that marks each pane's study ROLE so the reading
 * radiologist can tell — at a glance, on every viewport — which study is the one
 * they are dictating (the CURRENT / report target) versus a comparison PRIOR.
 * The danger this guards against is dictating or measuring on a prior by mistake.
 *
 *   CURRENT  -> green  "CURRENT · <date>"
 *   PRIOR    -> amber  "PRIOR · <date> · <interval>"   (interval = time before current)
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

/** Parse a DICOM date (YYYYMMDD...) into a Date, or undefined. */
function parseDicomDate(raw: unknown): Date | undefined {
  if (!raw || typeof raw !== 'string') {
    return undefined;
  }
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) {
    return undefined;
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Human, compact elapsed time from the prior study to the current study
 * (e.g. "5 d", "3 wk", "6 mo", "2.5 y"). Empty string when undeterminable.
 */
function formatInterval(currentDate: unknown, priorDate: unknown): string {
  const cur = parseDicomDate(currentDate);
  const pri = parseDicomDate(priorDate);
  if (!cur || !pri) {
    return '';
  }
  const days = Math.round((cur.getTime() - pri.getTime()) / 86400000);
  if (days <= 0) {
    return '';
  }
  if (days < 7) {
    return `${days} d`;
  }
  if (days < 56) {
    return `${Math.round(days / 7)} wk`;
  }
  if (days < 730) {
    return `${Math.round(days / 30)} mo`;
  }
  const years = days / 365;
  // One decimal under 5 years ("2.5 y"), whole years beyond.
  return `${years < 5 ? years.toFixed(1) : Math.round(years)} y`;
}

/** Find the CURRENT (report-target) study's date from the loaded display sets. */
function getCurrentStudyDate(servicesManager: any, activeStudyUID?: string): string | undefined {
  if (!activeStudyUID) {
    return undefined;
  }
  const displaySets = servicesManager?.services?.displaySetService?.getActiveDisplaySets?.() ?? [];
  const curDs = displaySets.find((d: any) => d?.StudyInstanceUID === activeStudyUID);
  return curDs?.instances?.[0]?.StudyDate ?? curDs?.SeriesDate;
}

function Tag({ color, label }: { color: string; label: string }) {
  return (
    <span
      data-cy="study-role-indicator"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1px 6px',
        borderRadius: 4,
        background: 'rgba(0, 0, 0, 0.55)',
        border: `1px solid ${color}`,
        color,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: color,
          flex: '0 0 auto',
        }}
      />
      {label}
    </span>
  );
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

    const fmt = (raw: unknown) =>
      raw && formatters?.formatDate ? formatters.formatDate(raw) : '';

    if (role === 'current') {
      const dateStr = fmt(getCurrentStudyDate(servicesManager, activeStudyUID));
      return <Tag color={CURRENT_COLOR} label={dateStr ? `CURRENT · ${dateStr}` : 'CURRENT'} />;
    }

    // role === 'prior'
    const priorDate = displaySet.instances?.[0]?.StudyDate ?? displaySet.SeriesDate;
    const dateStr = fmt(priorDate);
    const interval = formatInterval(getCurrentStudyDate(servicesManager, activeStudyUID), priorDate);
    const label = ['PRIOR', dateStr, interval].filter(Boolean).join(' · ');
    return <Tag color={PRIOR_COLOR} label={label} />;
  },
};

export default studyRoleOverlayItem;
