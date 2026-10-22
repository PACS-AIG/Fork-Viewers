import React, { useState } from 'react';
import { describeError } from './errorText';

/**
 * pacsai: what an area shows in place of what threw while rendering (an
 * ErrorBoundary's fallbackComponent, 22 Oct 2026): a viewport's pane, the
 * viewport grid, a side panel. The rest of the page keeps working. It looks
 * like the pane's card for images that could not open (cornerstone's
 * ViewportRecoveryCard): a line, Try again (render it afresh), and Details
 * (the error's own text).
 */
export type RenderErrorCardProps = {
  /** The area, for the DOM hook: [data-pacsai-render-error="viewport" | "grid" | "panel"]. */
  scope: 'viewport' | 'grid' | 'panel';
  title: string;
  error: unknown;
  resetErrorBoundary: () => void;
};

export function RenderErrorCard({ scope, title, error, resetErrorBoundary }: RenderErrorCardProps) {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <div
      data-pacsai-render-error={scope}
      role="alert"
      className="flex h-full min-h-0 w-full flex-1 items-center justify-center overflow-auto bg-black p-2"
    >
      {/* min-w-0: a side panel is narrower than the stack's longest word. */}
      <div className="border-secondary-light bg-secondary-dark min-w-0 max-w-sm rounded border p-4 text-white shadow-lg">
        <div className="mb-3 text-base font-medium">{title}</div>
        <div className="flex gap-2">
          <button
            type="button"
            data-pacsai-render-error-retry=""
            className="bg-primary-main hover:bg-primary-light rounded px-3 py-1 text-sm"
            onClick={resetErrorBoundary}
          >
            Try again
          </button>
          <button
            type="button"
            data-pacsai-render-error-details=""
            aria-expanded={showDetails}
            className="border-secondary-light hover:bg-secondary-light rounded border px-3 py-1 text-sm"
            onClick={() => setShowDetails(v => !v)}
          >
            Details
          </button>
        </div>
        {showDetails && (
          <pre
            data-pacsai-render-error-text=""
            className="text-common-light mt-3 max-h-32 select-text overflow-auto whitespace-pre-wrap break-words text-xs"
          >
            {describeError(error)}
          </pre>
        )}
      </div>
    </div>
  );
}
