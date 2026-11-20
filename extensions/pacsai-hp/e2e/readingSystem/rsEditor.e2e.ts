/**
 * RS-36: the CT reading system's Copilot, inbox and change list in the
 * radcopilot viewer, against the reading system's served API in fixture mode
 * (ct-analysis-system's gate rs-editor-ui; its BP-14b and the system's
 * invariants 1, 4, 5 and 16). Each test names the clause it checks.
 *
 * The tests share one server and run in file order (one worker): the inbox
 * tests change the records of the two fixture studies that have a late
 * result, so run them on a fresh record store. Only the three tests on one
 * study depend on each other; they run as one serial chain.
 */
import { expect, test } from '@playwright/test';
import type {
  RsEvidenceView,
  RsInbox,
  RsPassage,
  RsReport,
  RsVersions,
} from '../../src/readingSystem/rsContract';
import {
  doc,
  expectOpened,
  inboxCount,
  openStudy,
  pane,
  paneState,
  playLateResult,
  publishedShown,
} from './rsE2e';

const RICH = 'renal';
const UPDATE = 'machine_measurement_update';
const PROSE = 'clinician_prose';
/** BP-16's check: the pane never says these. */
const NEVER_SAID = ['confidence interval', 'drift'];
const texts = (passages: RsPassage[]) => passages.map(p => [p.id, p.owner, p.text]);

test('a study with no images opens on the radcopilot route with the complete published draft in the report column', async ({
  page,
  request,
}) => {
  await openStudy(page, RICH);
  const report = await doc<RsReport>(request, RICH, 'report?version=published');

  // Every passage of the published draft, as the API gives it (invariant 1: complete before the reader acts).
  for (const p of report.passages) {
    await expect(pane(page).locator(`[data-rs-passage="${p.id}"]`)).toHaveText(p.text);
  }
  await expect(publishedShown(page)).toHaveAttribute('data-rs-published', String(report.revision));
  // The chrome is apart from the prose: no chrome line sits inside the draft.
  await expect(pane(page).locator('[data-rs-draft] [data-rs-chrome]')).toHaveCount(0);

  // In the report column, above the report editor (the island and its cover start below the pane).
  const column = page.locator('[data-pacsai-reading-column]');
  await expect(column.locator('[data-pacsai-rs-pane]')).toHaveCount(1);
  const paneBox = await pane(page).boundingBox();
  const islandBox = await page.locator('[data-pacsai-reading-island]').boundingBox();
  expect(paneBox && islandBox).toBeTruthy();
  expect(islandBox!.y).toBeGreaterThanOrEqual(paneBox!.y + paneBox!.height - 1);

  // Folded to its bar, the pane gives the column back to the report editor.
  await pane(page).locator('[data-rs-collapse]').click();
  await expect(pane(page).locator('[data-rs-collapsed="true"]')).toBeVisible();
  await expect
    .poll(async () => (await pane(page).boundingBox())?.height ?? -1)
    .toBeLessThanOrEqual(40);
  await pane(page).locator('[data-rs-collapse]').click();
  await expect(pane(page).locator('[data-rs-draft]')).toBeVisible();

  const text = (await pane(page).innerText()).toLowerCase();
  for (const phrase of NEVER_SAID) {
    expect(text).not.toContain(phrase);
  }
});

test('clicking a sentence selects it and opens nothing; one key opens the Copilot on its finding', async ({
  page,
  request,
}) => {
  await openStudy(page, RICH);
  const evidence = await doc<RsEvidenceView>(request, RICH, 'evidence_view');
  // A measured finding with sources: the Copilot has something of each kind to show.
  const finding = evidence.findings.find(
    f =>
      (f.sources ?? []).length > 0 &&
      f.canonical?.value !== null &&
      f.canonical?.value !== undefined
  );
  if (!finding?.canonical) {
    throw new Error('the evidence view has no measured finding with sources');
  }
  const sentence = pane(page).locator(`[data-rs-entry="${finding.entryId}"]`).first();
  const copilot = pane(page).locator('[data-rs-copilot]');

  await sentence.click();
  await expect(sentence).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(750);
  await expect(copilot).toHaveCount(0);
  expect((await paneState(page))?.counts?.copilotOpens).toBe(0);

  // One key, from the sentence.
  await page.keyboard.press('k');
  await expect(pane(page).locator(`[data-rs-copilot="${finding.entryId}"]`)).toBeVisible();
  const measurement = String(finding.canonical.display ?? finding.canonical.value);
  await expect(copilot.locator('[data-rs-copilot-fact="Measurement"]')).toContainText(measurement);
  for (const s of finding.sources ?? []) {
    await expect(copilot.locator('[data-rs-copilot-list="sources"]')).toContainText(
      String(s.producer)
    );
  }
  for (const predicate of finding.unresolvedPredicates ?? []) {
    await expect(copilot.locator('[data-rs-copilot-list="unresolved"]')).toContainText(
      predicate.replace(/_/g, ' ')
    );
  }
  await page.keyboard.press('Escape');
  await expect(copilot).toHaveCount(0);

  // Enter on the selected sentence opens it as well.
  await sentence.focus();
  await page.keyboard.press('Enter');
  await expect(copilot).toBeVisible();
  await copilot.locator('[data-rs-copilot-close]').click();
  await expect(copilot).toHaveCount(0);

  // The key is typing, not a command, in a text field.
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.setAttribute('data-rs-e2e-field', '');
    document.body.appendChild(input);
    input.focus();
  });
  await page.keyboard.press('k');
  await page.waitForTimeout(300);
  await expect(copilot).toHaveCount(0);
});

// The late result on one study, in order: the inbox, Accept and Undo, then a stale action against the
// entry the Undo put back. A failure there skips the rest of this chain only.
test.describe.serial('a late result on one study', () => {
  test('a result that completes after opening lands in the inbox with its preview, and the published draft is unchanged', async ({
    page,
    request,
  }) => {
    await openStudy(page, UPDATE);
    await expectOpened(request, UPDATE);
    const before = await doc<RsReport>(request, UPDATE, 'report?version=published');
    await expect(inboxCount(page)).toHaveAttribute('data-rs-inbox-count', '0');

    playLateResult(UPDATE);

    await expect(inboxCount(page)).toHaveAttribute('data-rs-inbox-count', '1');
    const inbox = await doc<RsInbox>(request, UPDATE, 'inbox');
    expect(inbox.entries).toHaveLength(1);
    const entry = inbox.entries[0];

    // Invariant 5: the published draft did not move, in the API or on screen.
    const after = await doc<RsReport>(request, UPDATE, 'report?version=published');
    expect(after.revision).toBe(before.revision);
    expect(after.text).toBe(before.text);
    await expect(publishedShown(page)).toHaveAttribute(
      'data-rs-published',
      String(before.revision)
    );
    for (const p of before.passages) {
      await expect(pane(page).locator(`[data-rs-passage="${p.id}"]`)).toHaveText(p.text);
    }

    // The entry, with its exact consequence preview.
    await pane(page).locator('[data-rs-tab="inbox"]').click();
    const card = pane(page).locator(`[data-rs-inbox-entry="${entry.id}"]`);
    await expect(card).toContainText(entry.summary);
    const preview = entry.preview ?? [];
    expect(preview.length).toBeGreaterThan(0);
    for (const change of preview) {
      const line = card.locator(`[data-rs-change="${change.passageId}"]`);
      await expect(line.locator('[data-rs-before]')).toHaveText(String(change.before));
      await expect(line.locator('[data-rs-after]')).toHaveText(String(change.after));
    }

    // The change list: the latest evidence against the published draft.
    await pane(page).locator('[data-rs-tab="changes"]').click();
    const changed = inbox.changeList.changed ?? [];
    expect(changed.length).toBeGreaterThan(0);
    for (const change of changed) {
      const line = pane(page).locator(
        `[data-rs-change-group="changed"] [data-rs-change="${change.passageId}"]`
      );
      await expect(line.locator('[data-rs-after]')).toHaveText(String(change.after));
    }
  });

  test('accepting the entry publishes its Findings and Impression change at one revision, and one Undo restores the draft', async ({
    page,
    request,
  }) => {
    await openStudy(page, UPDATE);
    const before = await doc<RsReport>(request, UPDATE, 'report?version=published');
    const inbox = await doc<RsInbox>(request, UPDATE, 'inbox');
    expect(inbox.entries).toHaveLength(1);
    const entry = inbox.entries[0];

    await pane(page).locator('[data-rs-tab="inbox"]').click();
    await pane(page).locator(`[data-rs-accept="${entry.id}"]`).click();

    // One revision carries the whole change: every line of the preview, whichever section it is in.
    await expect(publishedShown(page)).toHaveAttribute(
      'data-rs-published',
      String(before.revision + 1)
    );
    const accepted = await doc<RsReport>(request, UPDATE, 'report?version=published');
    expect(accepted.revision).toBe(before.revision + 1);
    for (const change of entry.preview ?? []) {
      expect(accepted.text).toContain(String(change.after));
      expect(accepted.text).not.toContain(String(change.before));
    }
    const versions = await doc<RsVersions>(request, UPDATE, 'versions');
    const revision = versions.revisions.find(r => r.revision === before.revision + 1);
    if (!revision) {
      throw new Error('no revision for the acceptance');
    }
    expect(revision.operation?.inboxEntryId).toBe(entry.id);
    await expect(inboxCount(page)).toHaveAttribute('data-rs-inbox-count', '0');
    await pane(page).locator('[data-rs-tab="draft"]').click();
    for (const change of entry.preview ?? []) {
      await expect(pane(page).locator('[data-rs-draft]')).toContainText(String(change.after));
    }

    // Nothing left between the latest evidence and the published draft.
    await pane(page).locator('[data-rs-tab="changes"]').click();
    await expect(pane(page).locator('[data-rs-changelist-empty]')).toBeVisible();

    // One Undo of that intention restores the draft and puts the update back in the inbox.
    await pane(page).locator(`[data-rs-undo="${revision.revisionId}"]`).click();
    await expect(publishedShown(page)).toHaveAttribute(
      'data-rs-published',
      String(before.revision + 2)
    );
    const undone = await doc<RsReport>(request, UPDATE, 'report?version=published');
    expect(texts(undone.passages)).toEqual(texts(before.passages));
    await expect(inboxCount(page)).toHaveAttribute('data-rs-inbox-count', '1');
  });

  test('an action against a revision another reader moved is answered 409, and the pane shows the current draft', async ({
    browser,
    request,
  }) => {
    // Reader A's pane, with its version polls held at what it first read.
    const a = await browser.newPage();
    let held: string | null = null;
    await a.route('**/rs-api/studies/*/versions', async route => {
      if (held === null) {
        const res = await route.fetch();
        held = await res.text();
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: held });
    });
    await openStudy(a, UPDATE);
    const shown = await doc<RsReport>(request, UPDATE, 'report?version=published');
    const entry = (await doc<RsInbox>(request, UPDATE, 'inbox')).entries[0];
    expect(entry, 'the update is back in the inbox after the Undo').toBeTruthy();

    // Reader B accepts it first.
    const b = await browser.newPage();
    await openStudy(b, UPDATE);
    await pane(b).locator('[data-rs-tab="inbox"]').click();
    await pane(b).locator(`[data-rs-accept="${entry.id}"]`).click();
    await expect(publishedShown(b)).toHaveAttribute(
      'data-rs-published',
      String(shown.revision + 1)
    );

    // Reader A still shows the old revision and the entry; their Accept is refused as stale.
    await expect(publishedShown(a)).toHaveAttribute('data-rs-published', String(shown.revision));
    await pane(a).locator('[data-rs-tab="inbox"]').click();
    await pane(a).locator(`[data-rs-accept="${entry.id}"]`).click();
    await expect(pane(a).locator('[data-rs-notice="warn"]')).toContainText(
      `revision ${shown.revision + 1}`
    );
    await expect(publishedShown(a)).toHaveAttribute(
      'data-rs-published',
      String(shown.revision + 1)
    );
    expect((await paneState(a))?.counts?.conflicts).toBe(1);

    // Applied once: the record holds B's acceptance and nothing from A.
    const versions = await doc<RsVersions>(request, UPDATE, 'versions');
    expect(versions.published.revision).toBe(shown.revision + 1);
    await a.close();
    await b.close();
  });
});

test("rejecting an entry leaves the draft as it was, and a patch of the reader's own wording is shown, never applied", async ({
  page,
  request,
}) => {
  await openStudy(page, PROSE);
  await expectOpened(request, PROSE);
  const before = await doc<RsReport>(request, PROSE, 'report?version=published');

  playLateResult(PROSE);

  await expect(inboxCount(page)).toHaveAttribute('data-rs-inbox-count', '1');
  const entry = (await doc<RsInbox>(request, PROSE, 'inbox')).entries[0];
  await pane(page).locator('[data-rs-tab="inbox"]').click();
  const card = pane(page).locator(`[data-rs-inbox-entry="${entry.id}"]`);
  await expect(card).toContainText(entry.summary);
  for (const patch of entry.patches ?? []) {
    const shownPatch = card.locator(`[data-rs-patch="${patch.passageId}"]`);
    await expect(shownPatch).toContainText(patch.ours);
    await expect(shownPatch).toContainText(patch.theirs);
  }

  await pane(page).locator(`[data-rs-reject="${entry.id}"]`).click();
  await expect(inboxCount(page)).toHaveAttribute('data-rs-inbox-count', '0');
  const after = await doc<RsReport>(request, PROSE, 'report?version=published');
  expect(texts(after.passages)).toEqual(texts(before.passages));
  const inbox = await doc<RsInbox>(request, PROSE, 'inbox');
  for (const update of entry.updates) {
    expect(inbox.rejected).toContain(update);
  }
});
