import React, { useState, useEffect } from 'react';
import { ErrorBoundary as ReactErrorBoundary } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../Dialog/Dialog';
import { ScrollArea } from '../ScrollArea/ScrollArea';
import { Icons } from '../Icons';

const isProduction = process.env.NODE_ENV === 'production';

interface ErrorBoundaryError extends Error {
  message: string;
  stack?: string;
}

interface DefaultFallbackProps {
  error: ErrorBoundaryError;
  context: string;
  resetErrorBoundary: () => void;
}

interface ErrorBoundaryProps {
  context?: string;
  onReset?: () => void;
  onError?: (error: ErrorBoundaryError, componentStack: string, context: string) => void;
  fallbackComponent?: React.ComponentType<DefaultFallbackProps>;
  children: React.ReactNode;
  fallbackRoute?: string | null;
  isPage?: boolean;
  /** pacsai: the children render again when one of these changes (react-error-boundary's resetKeys). */
  resetKeys?: unknown[];
}

const DefaultFallback = ({
  error,
  context,
  resetErrorBoundary = () => {},
}: DefaultFallbackProps) => {
  const { t } = useTranslation('ErrorBoundary');
  const [showDetails, setShowDetails] = useState(false);
  // pacsai: `${!isProduction && …}` wrote "false" into the production title.
  const title = `${t('Something went wrong')}${isProduction ? '' : ` ${t('in')} ${context}`}.`;
  const subtitle = t('Sorry, something went wrong there. Try again.');

  const copyErrorDetails = () => {
    const errorDetails = `
Context: ${context}
Error Message: ${error.message}
Stack: ${error.stack}
    `;
    navigator.clipboard.writeText(errorDetails);
    toast.success(t('Copied to clipboard'));
  };

  useEffect(() => {
    toast.error(title, {
      description: subtitle,
      action: {
        label: t('Show Details'),
        onClick: () => setShowDetails(true),
      },
      // pacsai: it stays. Sonner reads 0 as its default (4 s), which left a
      // blank page with nothing saying why.
      duration: Infinity,
    });
  }, [error]);

  // pacsai: the dialog renders in production too, closed until the toast's
  // Show Details opens it (null there left that action doing nothing).
  return (
    <>
      <Dialog
        open={showDetails}
        onOpenChange={setShowDetails}
      >
        <DialogContent className="border-input h-[50vh] w-[90vw] border-2 sm:max-w-[900px]">
          <DialogHeader>
            <DialogTitle className="text-muted-foreground flex justify-between text-xl">
              <div className="flex items-center">{title}</div>
              <button
                onClick={() => {
                  copyErrorDetails();
                  setShowDetails(false);
                }}
                className="text-aqua-pale hover:text-aqua-pale/80 flex items-center gap-2 rounded bg-gray-800 px-4 py-2 font-light"
              >
                <Icons.Code className="h-4 w-4" />
                {t('Copy Details')}
              </button>
            </DialogTitle>

            <DialogDescription className="text-lg">{subtitle}</DialogDescription>
          </DialogHeader>

          <ScrollArea className="h-[100%]">
            <div className="space-y-4 pr-4 font-mono text-base">
              <div className="space-y-4">
                <p className="text-aqua-pale break-words text-lg">
                  {t('Context')}: {context}
                </p>
                <p className="text-aqua-pale break-words text-lg">
                  {t('Error Message')}: {error.message}
                </p>
                <pre className="text-aqua-pale whitespace-pre-wrap break-words rounded bg-gray-900 p-4">
                  Stack: {error.stack}
                </pre>
              </div>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
};

const ErrorBoundary = ({
  context = 'OHIF',
  onReset = () => {},
  onError = () => {},
  fallbackComponent: FallbackComponent = DefaultFallback,
  children,
  fallbackRoute = null,
  isPage,
  resetKeys,
}: ErrorBoundaryProps) => {
  // pacsai: a boundary catches what its own children throw while rendering,
  // nothing else. Each instance used to listen for the window's `error` and
  // `unhandledrejection` too, and take any of them, from anywhere on the page,
  // as its own (silenced in the console, logged at debug level only). One
  // reporter for the whole page logs and toasts those now
  // (platform/app/src/utils/errorReporting.ts), so a boundary per viewport
  // does not raise one toast per viewport for a single stray rejection.
  const onErrorHandler = (error: ErrorBoundaryError, info?: { componentStack?: string }) => {
    const componentStack = info?.componentStack ?? '';
    console.error(`${context} Error Boundary`, error, componentStack);
    onError(error, componentStack, context);
  };

  return (
    <ReactErrorBoundary
      fallbackRender={props => (
        <FallbackComponent
          error={props.error}
          context={context}
          resetErrorBoundary={props.resetErrorBoundary}
        />
      )}
      onReset={onReset}
      onError={onErrorHandler}
      resetKeys={resetKeys}
    >
      {children}
    </ReactErrorBoundary>
  );
};

export { ErrorBoundary };
