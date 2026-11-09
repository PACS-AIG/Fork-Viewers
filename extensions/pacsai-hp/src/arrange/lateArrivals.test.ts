/**
 * Rev 11 milestone 7, PR 3 (B31, N06; docs/12 §4): the session interaction
 * latch and the gate on automatic re-hangs. What counts as the reader working
 * the images; a re-hang runs untouched, is held once latched (or while an
 * Arrange preview is open), runs on Update layout; a case or a session study
 * starts clear; outside the reading window nothing is held.
 */
import {
  classifyInteraction,
  holdOrRun,
  interactionLatched,
  latchInteraction,
  lateCaseEntered,
  lateCaseLeft,
  lateCounts,
  lateFocusChanged,
  lateView,
  newImagesSinceHang,
  noteHung,
  releaseLateHold,
  setLateHold,
  subscribeLate,
  updateLayout,
  type HeldUpdate,
} from './lateArrivals';

const IMAGES: HeldUpdate = { kind: 'images', label: null };
const LAYOUT: HeldUpdate = { kind: 'layout', label: 'CTA Head/Neck' };

function page(): Record<string, HTMLElement> {
  document.body.innerHTML = `
    <header>
      <div data-cy="pacsai-reading-controls"><button id="arrange">Arrange</button>
        <div data-cy="pacsai-late-layout"><button id="update">Update layout</button></div></div>
      <button data-tool="WindowLevel" id="tool"><span id="toolIcon">W/L</span></button>
      <div role="menu"><div id="menuItem">Soft tissue</div></div>
      <span id="patient">Patient line</span>
    </header>
    <div data-cy="thumbnail-list"><div data-cy="study-browser-thumbnail" id="thumb"><img id="thumbImg" /></div></div>
    <div data-cy="viewport-grid"><div data-viewport-uid="vp1" id="viewport"><canvas id="canvas"></canvas>
      <div data-cy="viewport-overlay-top-left" id="overlay">Prior 2025</div></div></div>
    <div data-pacsai-reading-column><div data-pacsai-reading-island>
      <div contenteditable="true" id="report">FINDINGS</div><button id="reportButton">Sign</button></div></div>
    <div role="dialog" aria-label="Arrange"><button id="arrangeChoice">Manual</button></div>
    <input id="field" />`;
  const ids = [
    'arrange',
    'update',
    'tool',
    'toolIcon',
    'menuItem',
    'patient',
    'thumb',
    'thumbImg',
    'viewport',
    'canvas',
    'overlay',
    'report',
    'reportButton',
    'arrangeChoice',
    'field',
  ];
  return Object.fromEntries(ids.map(id => [id, document.getElementById(id) as HTMLElement]));
}

const ran = () => {
  const run = jest.fn();
  return run;
};

beforeEach(() => {
  setLateHold(() => false);
  lateCaseEntered(true);
});
afterEach(() => {
  lateCaseLeft();
  setLateHold(() => false);
  document.body.innerHTML = '';
});

describe('what counts as the reader working the images (classifyInteraction)', () => {
  it('a wheel or a press on the viewports: scrolling, measuring, a presentation tool on the image', () => {
    const el = page();
    expect(classifyInteraction({ type: 'wheel', target: el.canvas })).toBe('scroll');
    expect(classifyInteraction({ type: 'pointerdown', target: el.canvas })).toBe('images');
    // The viewport's own overlay (the prior's date chip) is the images too.
    expect(classifyInteraction({ type: 'pointerdown', target: el.overlay })).toBe('images');
    expect(classifyInteraction({ type: 'drop', target: el.viewport })).toBe('series');
  });

  it('the series rail (changing a series) and an image tool count', () => {
    const el = page();
    expect(classifyInteraction({ type: 'pointerdown', target: el.thumbImg })).toBe('series');
    expect(classifyInteraction({ type: 'dblclick', target: el.thumb })).toBe('series');
    expect(classifyInteraction({ type: 'dragstart', target: el.thumb })).toBe('series');
    expect(classifyInteraction({ type: 'pointerdown', target: el.toolIcon })).toBe('tool');
  });

  it('a key with nothing but the viewer focused counts; one typed into the report, a field, or a chord or F-key does not', () => {
    const el = page();
    expect(classifyInteraction({ type: 'keydown', target: document.body, key: 'ArrowDown' })).toBe(
      'keys'
    );
    expect(classifyInteraction({ type: 'keydown', target: document, key: 'PageDown' })).toBe(
      'keys'
    );
    expect(classifyInteraction({ type: 'keydown', target: el.canvas, key: 'i' })).toBe('keys');
    expect(
      classifyInteraction({ type: 'keydown', target: el.report, key: 'ArrowDown' })
    ).toBeNull();
    expect(classifyInteraction({ type: 'keydown', target: el.field, key: 'a' })).toBeNull();
    // Anywhere in the report, a field or not (its Sign button focused, Enter).
    expect(
      classifyInteraction({ type: 'keydown', target: el.reportButton, key: 'Enter' })
    ).toBeNull();
    // Alt+1/2/3 (the modes), Ctrl and Meta chords, F4 (the report's microphone).
    expect(
      classifyInteraction({ type: 'keydown', target: document.body, key: '1', altKey: true })
    ).toBeNull();
    expect(
      classifyInteraction({ type: 'keydown', target: document.body, key: 'k', ctrlKey: true })
    ).toBeNull();
    expect(
      classifyInteraction({ type: 'keydown', target: document.body, key: 'c', metaKey: true })
    ).toBeNull();
    for (const key of ['F4', 'F12', 'Shift', 'Tab', 'Escape', 'Meta', 'CapsLock', '']) {
      expect(classifyInteraction({ type: 'keydown', target: document.body, key })).toBeNull();
    }
  });

  it('the report, the reading controls, Arrange, menus, dialogs and the rest of the header never count', () => {
    const el = page();
    for (const target of [
      el.report,
      el.reportButton,
      el.arrange,
      el.update,
      el.arrangeChoice,
      el.menuItem,
      el.patient,
      el.field,
    ]) {
      for (const type of ['pointerdown', 'wheel', 'dblclick', 'drop']) {
        expect(classifyInteraction({ type, target })).toBeNull();
      }
    }
    // A wheel over the rail or the header is not the images.
    expect(classifyInteraction({ type: 'wheel', target: el.thumb })).toBeNull();
    expect(classifyInteraction({ type: 'pointerup', target: el.canvas })).toBeNull();
    expect(classifyInteraction({ type: 'pointerdown', target: null })).toBeNull();
  });
});

describe('the gate on automatic re-hangs (holdOrRun)', () => {
  it('untouched, a re-hang runs as before: late metadata may still improve the hanging', () => {
    const run = ran();
    const kind = jest.fn(() => IMAGES);
    expect(holdOrRun({ kind, run })).toBe('ran');
    expect(run).toHaveBeenCalledTimes(1);
    expect(kind).not.toHaveBeenCalled();
    expect(lateView().held).toBeNull();
    expect(lateCounts()).toMatchObject({ enabled: true, latched: false, ran: 1, holds: 0 });
  });

  it('once the reader worked the images, it is held and offered; Update layout runs it, once', () => {
    latchInteraction('scroll');
    expect(interactionLatched()).toBe(true);
    const run = ran();
    expect(holdOrRun({ kind: () => IMAGES, run })).toBe('held');
    expect(run).not.toHaveBeenCalled();
    expect(lateView()).toEqual({ latched: true, held: IMAGES });
    expect(lateCounts()).toMatchObject({
      latched: true,
      reason: 'scroll',
      held: 'images',
      holds: 1,
    });
    expect(updateLayout()).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(lateView().held).toBeNull();
    // The latch stays: the next arrival is held again; nothing left to update.
    expect(updateLayout()).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(interactionLatched()).toBe(true);
    expect(lateCounts()).toMatchObject({ updates: 1, held: null });
  });

  it('a held re-hang that brings nothing (no images arrived, the layout on screen kept) goes, offered never', () => {
    latchInteraction('images');
    const run = ran();
    expect(holdOrRun({ kind: () => null, run })).toBe('dropped');
    expect(run).not.toHaveBeenCalled();
    expect(lateView().held).toBeNull();
    expect(lateCounts()).toMatchObject({ drops: 1, holds: 0 });
    // A kind that throws is nothing to offer, not a re-hang run under the reader.
    expect(
      holdOrRun({
        kind: () => {
          throw new Error('no plan');
        },
        run,
      })
    ).toBe('dropped');
    expect(run).not.toHaveBeenCalled();
  });

  it('the latest held re-hang is the one Update layout runs; images that arrived for an earlier one stay the news', () => {
    latchInteraction('keys');
    const first = ran();
    const second = ran();
    holdOrRun({ kind: () => IMAGES, run: first });
    holdOrRun({ kind: () => LAYOUT, run: second });
    expect(lateView().held).toEqual(IMAGES);
    updateLayout();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    // Only the reader's layout waiting: said with its study type.
    holdOrRun({ kind: () => LAYOUT, run: first });
    expect(lateView().held).toEqual(LAYOUT);
  });

  it('a choice that re-hangs over everything loaded (browsing, Use this case, Reset) drops a held update', () => {
    latchInteraction('scroll');
    const run = ran();
    holdOrRun({ kind: () => IMAGES, run });
    latchInteraction('browsing', { hung: true });
    expect(lateView().held).toBeNull();
    expect(updateLayout()).toBe(false);
    expect(run).not.toHaveBeenCalled();
    // The first reason stays the latch's.
    expect(lateCounts().reason).toBe('scroll');
  });

  it('outside the reading window nothing is latched or held: every re-hang runs, as before', () => {
    lateCaseEntered(false);
    latchInteraction('scroll');
    expect(interactionLatched()).toBe(false);
    const run = ran();
    expect(holdOrRun({ kind: () => IMAGES, run })).toBe('ran');
    expect(run).toHaveBeenCalledTimes(1);
    expect(lateCounts()).toMatchObject({ enabled: false, latched: false });
  });

  it('a new case, or another study of the session in focus, starts clear: no latch, no update', () => {
    latchInteraction('scroll');
    const run = ran();
    holdOrRun({ kind: () => IMAGES, run });
    lateFocusChanged();
    expect(lateView()).toEqual({ latched: false, held: null });
    expect(holdOrRun({ kind: () => IMAGES, run })).toBe('ran');
    latchInteraction('tool');
    holdOrRun({ kind: () => IMAGES, run: ran() });
    lateCaseEntered(true);
    expect(lateView()).toEqual({ latched: false, held: null });
    expect(updateLayout()).toBe(false);
    lateCaseLeft();
    expect(lateCounts().enabled).toBe(false);
  });
});

describe('an open Arrange preview holds the re-hangs too', () => {
  it('held while it is open; closed untouched, the update runs by itself', () => {
    let open = true;
    setLateHold(() => open);
    const run = ran();
    expect(holdOrRun({ kind: () => IMAGES, run })).toBe('held');
    releaseLateHold(); // still open: nothing
    expect(run).not.toHaveBeenCalled();
    open = false;
    releaseLateHold();
    expect(run).toHaveBeenCalledTimes(1);
    expect(lateView().held).toBeNull();
    expect(lateCounts()).toMatchObject({ released: 1, updates: 0 });
  });

  it('closed after the reader worked the images (or chose them), the update stays offered', () => {
    let open = true;
    setLateHold(() => open);
    const run = ran();
    holdOrRun({ kind: () => IMAGES, run });
    latchInteraction('images');
    open = false;
    releaseLateHold();
    expect(run).not.toHaveBeenCalled();
    expect(lateView().held).toEqual(IMAGES);
  });
});

describe('the images the layout on screen was hung with', () => {
  const ds = (uid: string, more: Record<string, unknown> = {}) => ({
    displaySetInstanceUID: uid,
    numImageFrames: 40,
    ...more,
  });

  it('a series loaded since, or a shell now usable, is new; a composite, a shell or a frameless set is not', () => {
    noteHung([ds('a1'), ds('a2', { unsupported: true }), ds('a.all', { isAllInOne: true })]);
    expect(newImagesSinceHang([ds('a1')])).toBe(false);
    expect(
      newImagesSinceHang([
        ds('a1'),
        ds('p.all', { isAllInOne: true }),
        ds('sr', { numImageFrames: 0 }),
      ])
    ).toBe(false);
    expect(newImagesSinceHang([ds('a1'), ds('a2', { unsupported: true })])).toBe(false);
    expect(newImagesSinceHang([ds('a1'), ds('a2')])).toBe(true);
    expect(newImagesSinceHang([ds('a1'), ds('p1')])).toBe(true);
  });

  it("no hang seen yet counts as arrived (offered rather than dropped); a case's entry forgets the last", () => {
    expect(newImagesSinceHang([ds('a1')])).toBe(true);
    noteHung([ds('a1')]);
    expect(newImagesSinceHang([ds('a1')])).toBe(false);
    lateCaseEntered(true);
    expect(newImagesSinceHang([ds('a1')])).toBe(true);
  });

  it('the reading window watches the hanging service: each protocol change notes the images it was hung with', () => {
    const listeners: Array<() => void> = [];
    let sets = [ds('a1')];
    const unsubscribe = jest.fn();
    const hangingProtocolService = {
      EVENTS: { PROTOCOL_CHANGED: 'event::hanging_protocol_changed' },
      subscribe: jest.fn((event: string, cb: () => void) => {
        expect(event).toBe('event::hanging_protocol_changed');
        listeners.push(cb);
        return { unsubscribe };
      }),
    };
    lateCaseEntered(true, {
      hangingProtocolService,
      displaySetService: { getActiveDisplaySets: () => sets },
    });
    // Entered again with the same service: one subscription.
    lateCaseEntered(true, {
      hangingProtocolService,
      displaySetService: { getActiveDisplaySets: () => sets },
    });
    expect(hangingProtocolService.subscribe).toHaveBeenCalledTimes(1);
    const before = lateCounts().protocolChanges;
    listeners.forEach(l => l());
    expect(lateCounts().protocolChanges).toBe(before + 1);
    sets = [ds('a1'), ds('p1')];
    expect(newImagesSinceHang(sets)).toBe(true);
    listeners.forEach(l => l());
    expect(newImagesSinceHang(sets)).toBe(false);
  });
});

describe('the latch listens on the page (the reading window only)', () => {
  it('a wheel on the viewports latches; one on the report does not; outside the reading window none does', () => {
    const el = page();
    el.report.dispatchEvent(new Event('wheel', { bubbles: true }));
    expect(interactionLatched()).toBe(false);
    el.canvas.dispatchEvent(new Event('wheel', { bubbles: true }));
    expect(interactionLatched()).toBe(true);
    expect(lateCounts().reason).toBe('scroll');
    lateCaseEntered(false);
    el.canvas.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(interactionLatched()).toBe(false);
  });

  it('the header hears a change: its view is stable between changes', () => {
    const heard = jest.fn();
    const off = subscribeLate(heard);
    const first = lateView();
    expect(lateView()).toBe(first);
    latchInteraction('scroll');
    holdOrRun({ kind: () => IMAGES, run: ran() });
    expect(heard).toHaveBeenCalledTimes(2);
    expect(lateView()).not.toBe(first);
    off();
    updateLayout();
    expect(heard).toHaveBeenCalledTimes(2);
  });
});
