import React, { useState } from 'react';
import { describeError } from '../utils/errorReporting';

/**
 * What a viewport pane shows when its viewport threw while rendering (the
 * grid's per-viewport ErrorBoundary), and what the grid's area shows when the
 * grid itself did. Everything else on the page keeps working. It looks like
 * the pane's card for images that could not open (cornerstone's
 * ViewportRecoveryCard): a line, Try again (render it afresh), and Details
 * (the error's own text).
 */
type FallbackProps = {
  error: unknown;
  resetErrorBoundary: () => void;
};

function RenderErrorCard({
  scope,
  title,
  error,
  resetErrorBoundary,
}: FallbackProps & { scope: 'viewport' | 'grid'; title: string }) {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <div
      data-pacsai-render-error={scope}
      role="alert"
      className="flex h-full w-full items-center justify-center overflow-auto bg-black p-2"
    >
      <div className="border-secondary-light bg-secondary-dark max-w-sm rounded border p-4 text-white shadow-lg">
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
