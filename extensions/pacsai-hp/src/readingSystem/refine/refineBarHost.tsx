/**
 * RS-38: where the refine bar lives. One React root for the document, moved
 * into the viewport the lesion was marked on while a refine is in hand, and
 * taken out of the page when none is.
 */
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ensurePaneStyle } from '../RsPane';
import { RefineBar } from './RefineBar';
import type { RefineStore } from './refineStore';

export interface RefineBarHost {
  destroy(): void;
}

export function createRefineBarHost({
  win,
  store,
  elementOf,
}: {
  win: Window;
  store: RefineStore;
  /** The element of the viewport with this id (the refine overlay's), or null. */
  elementOf: (viewportId: string) => HTMLElement | null;
}): RefineBarHost {
  const doc = win.document;
  ensurePaneStyle(doc);
  const container = doc.createElement('div');
  container.setAttribute('data-pacsai-refine-bar-host', '');
  const root: Root = createRoot(container);
  root.render(<RefineBar store={store} />);

  const place = () => {
    const v = store.getView();
    const wanted =
      v.phase !== 'idle' && v.phase !== 'drawing' && v.viewportId ? elementOf(v.viewportId) : null;
    if (wanted) {
      if (container.parentElement !== wanted) {
        wanted.appendChild(container);
      }
    } else if (container.parentElement) {
      container.remove();
    }
  };
  const off = store.subscribe(place);
  place();

  return {
    destroy() {
      off();
      root.unmount();
      container.remove();
    },
  };
}
