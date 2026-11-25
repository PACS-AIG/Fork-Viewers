/**
 * RS-36: the pane's PathGrade tab end to end (output contract 1.16, D-343).
 *
 * The fixture-mode API serves a showcase only when one was built under its
 * own bundle and mode, so this test serves the two showcase routes itself
 * (as the anatomy test serves its archive): a showcase document shaped as
 * the contract's, with three real PNG pictures listed by their sha256. The
 * study and its evidence view are the served API's own.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { expect, test, type BrowserContext } from '@playwright/test';
import { doc, openStudy, pane } from './rsE2e';

const RICH = 'renal';

const NOTICE =
  'Research only. These are public kidney tumours from C4KC-KiTS, not this patient. Nothing here is a finding ' +
  'or a measurement of this study. No PathGrade model is enabled: the reference-case strip appears on a read ' +
  'only from a qualified characterizer, and none is qualified.';
const CREDIT =
  'Images: The Cancer Imaging Archive (TCIA), C4KC-KiTS, DOI 10.7937/TCIA.2019.IX49E8NX, CC BY 3.0';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});
const crc32 = (b: Buffer): number => {
  let c = 0xffffffff;
  for (const x of b) {
    c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};

/** A real PNG, one colour, so the browser decodes it (its size comes back as naturalWidth). */
function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      raw.set(rgb, y * row + 1 + x * 3);
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PICTURES: Record<string, Buffer> = {
  'outline_KiTS-00001.png': png(90, 60, [200, 60, 60]),
  'outline_KiTS-00002.png': png(90, 60, [60, 200, 60]),
  'growth_KiTS-00003.png': png(90, 60, [60, 60, 200]),
};

function showcase(pictures: Record<string, Buffer>): Record<string, unknown> {
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  return {
    contractVersion: 'pacsai.reading/1.16',
    artifact: 'pathgrade_showcase',
    snapshotId: null,
    studyUID: null,
    bundleHash: 'a'.repeat(64),
    mode: 'fixture',
    id: `pgs:${'0123456789abcdef'.repeat(2)}`,
    use: 'research',
    task: 'renal_subtype_grade',
    title: 'PathGrade on public kidney tumours',
    notice: NOTICE,
    cohort: {
      dataset: 'c4kc_kits',
      release: '2019-07',
      title: 'C4KC-KiTS',
      licence: 'CC BY 3.0',
      credit: 'The Cancer Imaging Archive (TCIA)',
      doi: '10.7937/TCIA.2019.IX49E8NX',
      permittedUse: 'retrieval_and_display',
    },
    sources: [{ kind: 'code', name: 'pathgrade.showcase', sha256: null }],
    sections: [
      {
        id: 'outlines',
        title: 'The machine’s outline and size beside the expert’s',
        items: [
          { kind: 'text', text: 'Yellow is the expert’s outline.\n\nRed is the machine’s.' },
          {
            kind: 'facts',
            facts: [{ label: 'Tumours', display: '75', value: 75, unit: null }],
          },
          {
            kind: 'figure',
            panels: [
              { image: 'outline_KiTS-00001.png', caption: 'KiTS-00001' },
              { image: 'outline_KiTS-00002.png', caption: 'KiTS-00002' },
              { image: 'growth_KiTS-00003.png', caption: 'KiTS-00003' },
            ],
            caption: 'Axial slices through each tumour’s widest part.',
          },
        ],
      },
      {
        id: 'standing',
        title: 'Where PathGrade stands',
        items: [
          {
            kind: 'table',
            caption: 'Funnel',
            columns: ['Dataset', 'Cases'],
            rows: [['C4KC-KiTS', '75']],
          },
        ],
      },
    ],
    images: Object.keys(PICTURES)
      .sort()
      .map(name => ({
        name,
        sha256: sha(PICTURES[name]),
        width: 90,
        height: 60,
        alt: `Axial slice, ${name}`,
      })),
  };
}

/** Serve the showcase routes (as the API and the app's proxy would); answers what was asked. */
async function serveShowcase(
  context: BrowserContext,
  answer: (path: string) => { status: number; type: string; body: string | Buffer }
): Promise<string[]> {
  const asked: string[] = [];
  await context.route(
    url => url.pathname.startsWith('/rs-api/showcase/pathgrade'),
    async route => {
      const path = new URL(route.request().url()).pathname.slice('/rs-api'.length);
      asked.push(path);
      const a = answer(path);
      return route.fulfill({ status: a.status, contentType: a.type, body: a.body });
    }
  );
  return asked;
}

test('the PathGrade tab: research only, its notice and credit, this study, its sections, each picture checked and shown', async ({
  page,
  context,
  request,
}) => {
  const doc0 = showcase(PICTURES);
  // One picture's bytes are not the ones listed: it is never shown.
  const served: Record<string, Buffer> = {
    ...PICTURES,
    'growth_KiTS-00003.png': png(90, 60, [1, 2, 3]),
  };
  const asked = await serveShowcase(context, path => {
    if (path === '/showcase/pathgrade') {
      return { status: 200, type: 'application/json', body: JSON.stringify(doc0) };
    }
    const bytes = served[path.slice('/showcase/pathgrade/'.length)];
    return bytes
      ? { status: 200, type: 'image/png', body: bytes }
      : {
          status: 404,
          type: 'application/json',
          body: JSON.stringify({ detail: 'no such picture' }),
        };
  });
  await openStudy(page, RICH);
  const tab = pane(page).locator('[data-rs-tab="pathgrade"]');
  await expect(tab).toHaveText('PathGrade (research)');
  // Nothing is read for a reader who has not opened the tab.
  expect(asked).toEqual([]);
  await tab.click();
  const panel = pane(page).locator('[data-rs-panel="pathgrade"]');
  await expect(panel.locator('[data-rs-pathgrade="ready"]')).toBeVisible();
  await expect(panel.locator('[data-rs-pathgrade-notice]')).toHaveText(NOTICE);
  await expect(panel.locator('[data-rs-pathgrade-credit]')).toHaveText(CREDIT);

  // This study: the served evidence view's findings with a reference-case strip, as it words them.
  const evidence = await doc<{
    findings: Array<{ referenceCaseStrip?: { display: string } | null }>;
  }>(request, RICH, 'evidence_view?version=published');
  const strips = evidence.findings
    .filter(f => f.referenceCaseStrip)
    .map(f => f.referenceCaseStrip!.display);
  if (strips.length) {
    await expect(panel.locator('[data-rs-pathgrade-strip]')).toHaveCount(strips.length);
    for (let n = 0; n < strips.length; n++) {
      await expect(panel.locator('[data-rs-pathgrade-strip]').nth(n)).toContainText(strips[n]);
    }
  } else {
    await expect(panel.locator('[data-rs-pathgrade-study] p')).toHaveText(
      'No finding in this study has a reference-case strip.'
    );
  }

  // The sections in order, as the API words them.
  await expect(panel.locator('[data-rs-pathgrade-section] h4')).toHaveText([
    'The machine’s outline and size beside the expert’s',
    'Where PathGrade stands',
  ]);
  await expect(panel.locator('[data-rs-pathgrade-item="text"] p')).toHaveText([
    'Yellow is the expert’s outline.',
    'Red is the machine’s.',
  ]);
  await expect(panel.locator('[data-rs-pathgrade-item="facts"] dd')).toHaveText(['75']);
  await expect(panel.locator('.prs-pg-table td')).toHaveText(['C4KC-KiTS', '75']);

  // The two pictures whose bytes match are decoded from object URLs; the third says why it is not shown.
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll('img[data-rs-pathgrade-image]')].map(i => {
          const img = i as HTMLImageElement;
          return [
            img.getAttribute('data-rs-pathgrade-image'),
            img.naturalWidth,
            img.src.slice(0, 5),
          ];
        })
      )
    )
    .toEqual([
      ['outline_KiTS-00001.png', 90, 'blob:'],
      ['outline_KiTS-00002.png', 90, 'blob:'],
    ]);
  await expect(panel.locator('[data-rs-pathgrade-picture="refused"]')).toHaveText(
    'Its bytes are not the ones the showcase lists, so it is not shown.'
  );
  expect([...asked].sort()).toEqual([
    '/showcase/pathgrade',
    '/showcase/pathgrade/growth_KiTS-00003.png',
    '/showcase/pathgrade/outline_KiTS-00001.png',
    '/showcase/pathgrade/outline_KiTS-00002.png',
  ]);

  if (process.env.RS_E2E_SHOTS) {
    await pane(page).screenshot({
      path: path.join(__dirname, 'test-results', 'pathgrade-tab.png'),
    });
  }

  // A click shows a picture larger under its row; Escape closes it.
  await panel.locator('.prs-pg-picture').nth(1).click();
  const larger = panel.locator('[data-rs-pathgrade-larger]');
  await expect(larger).toHaveAttribute('data-rs-pathgrade-larger', 'outline_KiTS-00002.png');
  await page.keyboard.press('Escape');
  await expect(larger).toHaveCount(0);
});

test('the PathGrade tab says plainly when no showcase is served', async ({ page, context }) => {
  const asked = await serveShowcase(context, () => ({
    status: 404,
    type: 'application/json',
    body: JSON.stringify({ detail: 'no PathGrade showcase is served: none is configured' }),
  }));
  await openStudy(page, RICH);
  await pane(page).locator('[data-rs-tab="pathgrade"]').click();
  await expect(pane(page).locator('[data-rs-pathgrade-reason]')).toHaveText(
    'No PathGrade showcase is served: none is configured.'
  );
  expect(asked).toEqual(['/showcase/pathgrade']);
});
