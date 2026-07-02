/**
 * PACS AI runtime theme switcher: 'dark' (default navy/cyan) or 'night'
 * (warm amber chrome for late shifts). Switching toggles the
 * `pacsai-theme-night` class on <html>; both the --pacs-* chrome triplets and
 * the shadcn HSL variables are swapped by CSS (platform/ui/src/tailwind.css).
 * ONLY UI chrome changes — the diagnostic image (canvas pixels, VOI) is never
 * tinted by either theme.
 *
 * The choice persists in localStorage 'pacsai.theme' (a preference, never
 * PHI) and is applied at app startup (App.tsx) so both the study list and the
 * viewer honor it.
 */

export type PacsaiTheme = 'dark' | 'night';

const STORAGE_KEY = 'pacsai.theme';
const NIGHT_CLASS = 'pacsai-theme-night';

export function getPacsaiTheme(): PacsaiTheme {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'night' ? 'night' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Apply a theme (or the persisted one) to <html> and persist it. */
export function applyPacsaiTheme(theme: PacsaiTheme = getPacsaiTheme()): PacsaiTheme {
  try {
    document.documentElement.classList.toggle(NIGHT_CLASS, theme === 'night');
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* non-browser context / storage unavailable — stay on default */
  }
  return theme;
}

/** Flip dark <-> night; returns the newly active theme. */
export function togglePacsaiTheme(): PacsaiTheme {
  return applyPacsaiTheme(getPacsaiTheme() === 'night' ? 'dark' : 'night');
}
