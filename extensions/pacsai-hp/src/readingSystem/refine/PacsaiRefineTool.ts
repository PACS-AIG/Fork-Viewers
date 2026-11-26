/**
 * RS-38, the refine tool in the main toolbar: a cornerstone tool on the
 * primary mouse button. A click marks a lesion with a point, a drag with a
 * box; letting go sends the refine (refineStore).
 *
 * It is a plain tool, not an annotation tool: it makes no annotation, so
 * nothing it does becomes a measurement (OHIF's measurement service maps
 * annotations), and it consumes the mouse-down, so an annotation's handle
 * under the mark is not grabbed. The drawing (the rubber band, the outlines)
 * is the refine overlay's. A mark is taken only on a stack viewport: SAM2CT
 * takes a mark on one of the series' own slices.
 *
 * The mouse-up comes as cornerstone's MOUSE_UP (after a drag) or MOUSE_CLICK
 * (a click) on the element; the tool listens for them from its mouse-down,
 * as cornerstone gives `mouseUpCallback` only to the first active tool that
 * has one.
 */
import { getEnabledElement, metaData as csMetaData } from '@cornerstonejs/core';
import { BaseTool, Enums as ToolsEnums, addTool } from '@cornerstonejs/tools';
import type { CornerstoneApi } from '../anatomy/anatomyOverlay';
import { currentRefineStore, setRefineToolArmed } from './refineCurrent';
import { createRefineGesture, type RefineGesture, type RefineMouseDetail } from './refineGesture';
import type { RefineViewport } from './refineViewport';

export const REFINE_TOOL_NAME = 'PacsaiRefine';

export class PacsaiRefineTool extends BaseTool {
  static toolName = REFINE_TOOL_NAME;

  private gesture: RefineGesture = createRefineGesture({
    store: currentRefineStore,
    viewportOf: element => {
      try {
        const vp = getEnabledElement(element as HTMLDivElement)?.viewport as unknown as
          | RefineViewport
          | undefined;
        return vp ?? null;
      } catch (_) {
        return null;
      }
    },
    metaData: csMetaData as unknown as CornerstoneApi['metaData'],
  });

  private offEnd: (() => void) | null = null;

  constructor(
    toolProps = {},
    defaultToolProps = { supportedInteractionTypes: ['Mouse'], configuration: {} }
  ) {
    super(toolProps, defaultToolProps);
  }

  preMouseDownCallback = (evt: { detail: RefineMouseDetail }): boolean => {
    const consumed = this.gesture.down(evt.detail);
    if (this.gesture.marking) {
      this.listenForEnd(evt.detail.element);
    }
    return consumed;
  };

  mouseDragCallback = (evt: { detail: RefineMouseDetail }): void => {
    this.gesture.drag(evt.detail);
  };

  private listenForEnd(element: HTMLElement): void {
    this.offEnd?.();
    const { MOUSE_UP, MOUSE_CLICK } = ToolsEnums.Events;
    const onEnd = (e: Event) => {
      this.offEnd?.();
      this.gesture.up((e as CustomEvent<RefineMouseDetail>).detail);
    };
    element.addEventListener(MOUSE_UP, onEnd);
    element.addEventListener(MOUSE_CLICK, onEnd);
    this.offEnd = () => {
      element.removeEventListener(MOUSE_UP, onEnd);
      element.removeEventListener(MOUSE_CLICK, onEnd);
      this.offEnd = null;
    };
  }

  onSetToolActive(): void {
    setRefineToolArmed(true);
  }

  onSetToolPassive(): void {
    this.offEnd?.();
    setRefineToolArmed(false);
  }

  onSetToolEnabled(): void {
    setRefineToolArmed(false);
  }

  onSetToolDisabled(): void {
    this.offEnd?.();
    setRefineToolArmed(false);
  }
}

/** The tool known to cornerstone (idempotent): before a tool group adds it. */
export function registerRefineTool(): void {
  addTool(PacsaiRefineTool);
}
