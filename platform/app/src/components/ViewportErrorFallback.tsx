import React from 'react';
import { RenderErrorCard } from '@ohif/ui-next';

/**
 * What a viewport pane shows when its viewport threw while rendering (the
 * grid's per-viewport ErrorBoundary), and what the grid's area shows when the
 * grid itself did: ui-next's RenderErrorCard. Everything else on the page
 * keeps working.
 */
type FallbackProps = {
  error: unknown;
  resetErrorBoundary: () => void;
};

/** One viewport's pane. */
export function ViewportErrorFallback(props: FallbackProps) {
  return (
    <RenderErrorCard
      {...props}
      scope="viewport"
      title="This series could not be displayed"
    />
  );
}

/** The whole grid's area. */
export function ViewportGridErrorFallback(props: FallbackProps) {
  return (
    <RenderErrorCard
      {...props}
      scope="grid"
      title="The images could not be displayed"
    />
  );
}
