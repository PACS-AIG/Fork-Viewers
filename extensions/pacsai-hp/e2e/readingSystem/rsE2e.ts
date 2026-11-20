/**
 * RS-36: helpers for the reading-system pane's end-to-end tests. Studies are
 * named by their fixture key and reached through the harness's helpers, so no
 * study UID is written in a test, printed or kept in a trace's name; the
 * documents a test compares with are the served API's own (nothing of the
 * reading system's fixtures is copied into this repository).
 */
import { execFileSync } from 'node:child_process';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** The study's document as the served API gives it (`route`: report?version=published, inbox, versions, ...). */
export async function doc<T>(
  request: APIRequestContext,
  fixture: string,
  route: string
): Promise<T> {
  const res = await request.get(
    `/rs-e2e/doc?fixture=${encodeURIComponent(fixture)}&route=${encodeURIComponent(route)}`
  );
  expect(res.status(), `GET ${route} for ${fixture}`).toBe(200);
  return (await res.json()) as T;
}

export const pane = (page: Page) => page.locator('[data-pacsai-rs-pane]');

/** Open the fixture's study on the radcopilot route and wait for the pane to read it. */
export async function openStudy(page: Page, fixture: string): Promise<void> {
  await page.goto(`/rs-e2e/open?fixture=${encodeURIComponent(fixture)}`);
  await expect(pane(page).locator('[data-rs-phase="ready"]')).toBeVisible();
}

/** The pane's harness state (studies by reference, never by UID). */
export type PaneState = { counts?: Record<string, number> } & Record<string, unknown>;
type HarnessWindow = { __pacsaiReadingSystem?: { getState: () => PaneState | null } };
export const paneState = (page: Page): Promise<PaneState | null> =>
  page.evaluate(
    () => (window as unknown as HarnessWindow).__pacsaiReadingSystem?.getState() ?? null
  );

/**
 * Commit the fixture's late result into the served record, as a model result
 * that completes after the reader opened the study. The gate supplies the
 * command (RS_E2E_LATE_RESULT, with `{fixture}` for the key); without it this
 * fails rather than skips, so a gate that is not wired never passes quietly.
 */
export function playLateResult(fixture: string): void {
  const template = process.env.RS_E2E_LATE_RESULT;
  if (!template) {
    throw new Error(
      'RS_E2E_LATE_RESULT is not set: the gate must give the command that commits a fixture late result (README.md)'
    );
  }
  if (!/^[a-z0-9_]+$/.test(fixture)) {
    throw new Error(`not a fixture key: ${fixture}`);
  }
  execFileSync('sh', ['-c', template.split('{fixture}').join(fixture)], {
    stdio: 'pipe',
    timeout: 60_000,
  });
}

/** Wait until the API says the pane opened the study (it posts `opened` on its first read). */
export async function expectOpened(request: APIRequestContext, fixture: string): Promise<void> {
  await expect
    .poll(async () => (await doc<{ opened: boolean }>(request, fixture, 'versions')).opened, {
      timeout: 20_000,
    })
    .toBe(true);
}

export const inboxCount = (page: Page) => pane(page).locator('[data-rs-inbox-count]');
export const publishedShown = (page: Page) => pane(page).locator('[data-rs-published]');
