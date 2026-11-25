/**
 * RS-36: the pane's PathGrade tab end to end: this study's PathGrade results
 * only (WeiWei, 25 Nov 2026; the reading system's D-344).
 *
 * The tab is there only while a finding of the study has a held
 * reference-case strip (a qualified characterizer for its class), and lists
 * those findings. The served study's strip is empty ("no licensed cohort"),
 * so its tab is hidden; for the shown case the test turns that strip held in
 * the evidence view the pane reads (the rest of the document is the served
 * API's own). The pane never reads a showcase.
 */
import { expect, test, type BrowserContext } from '@playwright/test';
import { doc, openStudy, pane } from './rsE2e';

const RICH = 'renal';

type Strip = { state: string; reason: string; display: string } | null | undefined;
type Evidence = {
  findings: Array<{ kind: string; className?: string | null; referenceCaseStrip?: Strip }>;
};

const HELD = {
  state: 'held',
  reason: 'qualified_characterizer',
  display: 'Reference cases: 4 public cases of this class',
};

/** Every request the page makes for a showcase (there should be none). */
async function showcaseReads(context: BrowserContext): Promise<string[]> {
  const asked: string[] = [];
  await context.route(
    url => url.pathname.includes('/showcase'),
    route => {
      asked.push(new URL(route.request().url()).pathname);
      return route.fulfill({ status: 404, body: '' });
    }
  );
  return asked;
}

test('the PathGrade tab is hidden for a study without a held strip, and no showcase is read', async ({
  page,
  context,
  request,
}) => {
  const asked = await showcaseReads(context);
  const evidence = await doc<Evidence>(request, RICH, 'evidence_view?version=published');
  // The served study's strips: none held (its one strip is empty).
  expect(evidence.findings.filter(f => f.referenceCaseStrip?.state === 'held')).toEqual([]);
  await openStudy(page, RICH);
  await expect(pane(page).locator('[data-rs-tab="draft"]')).toBeVisible();
  await expect(pane(page).locator('[data-rs-tab="pathgrade"]')).toHaveCount(0);
  expect(asked).toEqual([]);
});

test("with a held strip, the PathGrade tab lists the study's finding as the strip words it", async ({
  page,
  context,
}) => {
  const asked = await showcaseReads(context);
  let shown: Evidence['findings'][number] | null = null;
  await context.route(
    url => /^\/rs-api\/studies\/[^/]+\/evidence_view$/.test(url.pathname),
    async route => {
      const answer = await route.fetch();
      const ev = (await answer.json()) as Evidence;
      ev.findings[0] = { ...ev.findings[0], referenceCaseStrip: HELD };
      shown = ev.findings[0];
      return route.fulfill({ response: answer, json: ev });
    }
  );
  await openStudy(page, RICH);
  const tab = pane(page).locator('[data-rs-tab="pathgrade"]');
  await expect(tab).toHaveText('PathGrade (1)');
  await tab.click();
  const strips = pane(page).locator('[data-rs-panel="pathgrade"] [data-rs-pathgrade-strip]');
  await expect(strips).toHaveCount(1);
  await expect(strips.first()).toContainText(HELD.display);
  // The finding named as the pane names it: its kind as words, capitalised, then its class.
  const f = shown!;
  const kind = f.kind.replace(/_/g, ' ').trim();
  const name = [kind[0].toUpperCase() + kind.slice(1), f.className].filter(Boolean).join(' · ');
  await expect(strips.first().locator('.prs-pg-finding')).toHaveText(name);
  expect(asked).toEqual([]);
});
