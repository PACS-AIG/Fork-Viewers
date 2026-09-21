import React, { useState } from 'react';

/**
 * Per-viewport recovery (Rev 11 milestone 2, B02 part 4; spec §13 fix
 * contract item 7): when this viewport's images could not open, say so in
 * the pane instead of leaving it blank, and offer Retry viewer — which
 * rebuilds the rendering engine and reloads every viewport of the grid — and
 * Details, the error code and message. The report is another window; nothing
 * here touches it.
 */
export interface ViewportRecoveryError {
  code: string;
  message?: string;
}

export default function ViewportRecoveryCard({
  error,
  onRetry,
}: {
  error: ViewportRecoveryError;
  onRetry: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <div
      data-pacsai-recovery-card=""
      role="alert"
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/80"
    >
      <div className="max-w-sm rounded border border-secondary-light bg-secondary-dark p-4 text-white shadow-lg">
        <div className="mb-3 text-base font-medium">Images could not open</div>
        <div className="flex gap-2">
          <button
            type="button"
            data-pacsai-retry=""
            className="rounded bg-primary-main px-3 py-1 text-sm hover:bg-primary-light"
            onClick={onRetry}
          >
            Retry viewer
          </button>
          <button
            type="button"
            data-pacsai-details=""
            className="rounded border border-secondary-light px-3 py-1 text-sm hover:bg-secondary-light"
            onClick={() => setShowDetails(v => !v)}
          >
            Details
          </button>
        </div>
        {showDetails && (
          <pre
            data-pacsai-recovery-details=""
            className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs text-common-light"
          >
            {error.code}
            {error.message ? `\n${error.message}` : ''}
          </pre>
        )}
      </div>
    </div>
  );
}

/** The document-wide signal that every viewport of the grid should reload. */
export const VIEWER_RETRY_EVENT = 'pacsai:viewer-retry';
