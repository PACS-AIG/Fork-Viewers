import { readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import {
  CASE_OPENED_ACTION,
  CLOSE_WINDOW_ACTION,
  MAX_CASES_IN_DOCUMENT,
  OPEN_CASE_ACTION,
  OPEN_CASE_ANSWER_MS,
  OPEN_CASE_FALLBACK_MS,
  READING_CHANNEL_VECTORS_SHA256,
  WORKSPACE_STATE_ACTION,
  buildAdvert,
  buildCloseWindow,
  caseOpenedAnswer,
  decideReadingCommand,
  mintDocumentId,
  parseOpenCase,
  readingRouteFor,
  screenCaseCommand,
  type OpenCaseCommand,
  type ReadingCommandContext,
} from './readingChannel';

// The channel between the worklist and its reading window (Rev 11 milestone 6,
// approach C, phase 2), against the golden vectors the app generated from its
// own rules (the same bytes as the app's src/app/lib/readingChannel.vectors.json).
const bytes = readFileSync(join(__dirname, 'readingChannel.vectors.json'));
const V = JSON.parse(bytes.toString('utf8'));

describe('readingChannel: the vectors', () => {
  it('are the pinned bytes (the app pins the same)', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(READING_CHANNEL_VECTORS_SHA256);
    expect(READING_CHANNEL_VECTORS_SHA256).toBe(
      '32b2c070483a02a07b215ddf3fd60f14b0cab834ffbf7f3ea9cd789c299d35e7'
    );
    expect(V.constants).toEqual({
      openCase: OPEN_CASE_ACTION,
      caseOpened: CASE_OPENED_ACTION,
      workspaceState: WORKSPACE_STATE_ACTION,
      closeWindow: CLOSE_WINDOW_ACTION,
      fallbackMs: OPEN_CASE_FALLBACK_MS,
      answerMs: OPEN_CASE_ANSWER_MS,
    });
  });

  it('every workspaceOpenCase parses as the app parses it', () => {
    expect(V.commands.length).toBeGreaterThanOrEqual(20);
    for (const v of V.commands) {
      const p = parseOpenCase(v.raw);
      expect([v.name, p.ok]).toEqual([v.name, v.ok]);
      if (p.ok === true) {
        expect([v.name, p.value]).toEqual([v.name, v.value]);
      } else {
        expect([v.name, p.reason]).toEqual([v.name, v.reason]);
      }
    }
  });

  it('screens a command as the app screens one: opener, origin, action, payload', () => {
    for (const v of V.screen) {
      const r = screenCaseCommand(v.event, v.ownOrigin);
      expect([v.name, r.kind]).toEqual([v.name, v.kind]);
      if (r.kind === 'ignored') {
        expect([v.name, r.why]).toEqual([v.name, v.why]);
      }
      if (r.kind === 'command') {
        expect([v.name, r.command]).toEqual([v.name, v.command]);
      }
    }
  });

  it('builds each answer byte for byte as the app reads it', () => {
    for (const v of V.answers) {
      const built = caseOpenedAnswer(v.build.command, v.build.documentId, v.build.verdict);
      expect([v.name, JSON.stringify(built)]).toEqual([v.name, JSON.stringify(v.raw)]);
    }
  });

  it('builds the advertisement the app reads (no layout state)', () => {
    const can = V.adverts.find(a => a.name === 'the reading window can switch in its page');
    const cannot = V.adverts.find(a => a.name.startsWith('it cannot switch'));
    const launch = can.raw.activeLaunch;
    expect(
      JSON.stringify(
        buildAdvert({ documentId: can.raw.documentId, activeLaunch: launch, caseSwitch: true })
      )
    ).toBe(JSON.stringify(can.raw));
    expect(
      JSON.stringify(
        buildAdvert({ documentId: cannot.raw.documentId, activeLaunch: launch, caseSwitch: false })
      )
    ).toBe(JSON.stringify(cannot.raw));
    expect(can.read.caseSwitch).toBe(true);
    expect(cannot.read.caseSwitch).toBe(false);
    // No launch: never a switch (the app reads such an advert as no switch).
    expect(
      buildAdvert({ documentId: can.raw.documentId, activeLaunch: null, caseSwitch: true })
    ).toEqual({ action: WORKSPACE_STATE_ACTION, documentId: can.raw.documentId });
    expect(() =>
      buildAdvert({ documentId: 'doc_1', activeLaunch: launch, caseSwitch: true })
    ).toThrow();
  });

  it('builds the closeWindow relay the app honours for the case it shows', () => {
    for (const v of V.closeWindow) {
      if (typeof v.raw.sessionId === 'string') {
        expect([v.name, buildCloseWindow(v.raw.sessionId)]).toEqual([v.name, v.raw]);
      } else {
        expect([v.name, buildCloseWindow(v.raw.sessionId)]).toEqual([v.name, null]);
      }
    }
    expect(buildCloseWindow('att 1')).toBeNull();
    expect(buildCloseWindow(undefined)).toBeNull();
  });
});

describe('readingChannel: what this window does with a command', () => {
  const command = (over: Partial<OpenCaseCommand> = {}): OpenCaseCommand => ({
    action: OPEN_CASE_ACTION,
    requestId: 'req-11111111',
    studyInstanceUid: '1.2.826.0.1.3680043.10.2002',
    attempt: 'att-bbbb2222',
    attemptT0: 1759300005000,
    gatewayAET: 'GW1',
    ...over,
  });
  const ctx = (over: Partial<ReadingCommandContext> = {}): ReadingCommandContext => ({
    phase: 'mounted',
    routeStudy: '1.2.826.0.1.3680043.10.2001',
    caseState: 'reportable',
    documentGateways: ['GW1'],
    casesInDocument: 1,
    ...over,
  });

  it('switches in this document: another study on its gateway', () => {
    expect(decideReadingCommand(command(), ctx())).toEqual({ verdict: 'switch' });
    expect(decideReadingCommand(command(), ctx({ phase: 'loading', caseState: null }))).toEqual({
      verdict: 'switch',
    });
    expect(
      decideReadingCommand(command(), ctx({ casesInDocument: MAX_CASES_IN_DOCUMENT - 1 }))
    ).toEqual({ verdict: 'switch' });
  });

  it('focuses only for the case already shown, unless it could not be opened', () => {
    const same = command({ studyInstanceUid: '1.2.826.0.1.3680043.10.2001' });
    expect(decideReadingCommand(same, ctx())).toEqual({ verdict: 'focus-only' });
    expect(decideReadingCommand(same, ctx({ caseState: null, phase: 'loading' }))).toEqual({
      verdict: 'focus-only',
    });
    expect(decideReadingCommand(same, ctx({ caseState: 'unavailable' }))).toEqual({
      verdict: 'refuse',
      reason: 'reload',
    });
  });

  it('accepts another gateway, or a 13th case, into a fresh document', () => {
    expect(decideReadingCommand(command({ gatewayAET: 'GW2' }), ctx())).toEqual({
      verdict: 'reload',
      why: 'gateway',
    });
    expect(
      decideReadingCommand(command(), ctx({ casesInDocument: MAX_CASES_IN_DOCUMENT }))
    ).toEqual({ verdict: 'reload', why: 'cases' });
    expect(MAX_CASES_IN_DOCUMENT).toBe(12);
  });

  it('refuses (a fresh document is the retry) when the report failed, the dock is going, or no gateway came', () => {
    expect(decideReadingCommand(command(), ctx({ phase: 'failed' }))).toEqual({
      verdict: 'refuse',
      reason: 'reload',
    });
    expect(decideReadingCommand(command(), ctx({ phase: 'gone' }))).toEqual({
      verdict: 'refuse',
      reason: 'reload',
    });
    const noGateway = command();
    delete noGateway.gatewayAET;
    expect(decideReadingCommand(noGateway, ctx())).toEqual({ verdict: 'refuse', reason: 'reload' });
  });
});

describe('readingChannel: the reading route for a case', () => {
  const launch = { attempt: 'att-bbbb2222', attemptT0: 1759300005000 };
  it("keeps the route it was opened on and carries the study, gateways and the case's own launch, nothing else", () => {
    const url = readingRouteFor({
      href: 'http://localhost:3000/viewer/notfoundstudy?SeriesInstanceUIDs=1.2.3&token=x&attempt=att-old&attemptT0=1#frag',
      openedPath: '/viewer/viewer/radcopilot',
      studyInstanceUid: '1.2.826.0.1.3680043.10.2002',
      gateways: ['GW1', 'GW1', 'GW2'],
      launch,
    });
    expect(url).toBe(
      'http://localhost:3000/viewer/viewer/radcopilot?StudyInstanceUIDs=1.2.826.0.1.3680043.10.2002&gatewayAET=GW1&gatewayAET=GW2&attempt=att-bbbb2222&attemptT0=1759300005000'
    );
  });
  it('gives none for an invalid study, gateway or launch', () => {
    const base = {
      href: 'http://localhost:3000/viewer/viewer/radcopilot',
      openedPath: null,
      studyInstanceUid: '1.2.3',
      gateways: ['GW1'],
      launch,
    };
    expect(readingRouteFor(base)).not.toBeNull();
    expect(readingRouteFor({ ...base, studyInstanceUid: '1.2.x' })).toBeNull();
    expect(readingRouteFor({ ...base, gateways: [] })).toBeNull();
    expect(readingRouteFor({ ...base, gateways: ['undefined'] })).toBeNull();
    expect(readingRouteFor({ ...base, launch: { attempt: 'att 1', attemptT0: 1 } })).toBeNull();
    expect(readingRouteFor({ ...base, href: 'not a url' })).toBeNull();
  });
});

describe('readingChannel: document ids', () => {
  it('are 32 lower-case hex characters, from 16 random bytes', () => {
    const id = mintDocumentId(n => new Uint8Array(n).map((_, i) => i * 17));
    expect(id).toBe('00112233445566778899aabbccddeeff');
    expect(/^[0-9a-f]{32}$/.test(mintDocumentId())).toBe(true);
    expect(() => mintDocumentId(() => new Uint8Array(4))).toThrow();
  });
});
