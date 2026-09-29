import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { captureReactError } from '@/lib/sentry';

type Props = { children: ReactNode };
type State = { hasError: boolean; error: Error | null };

// Catches render-time errors that Sentry's window.onerror handler does not see
// (React swallows them by default). Always rendered, with or without Sentry —
// captureReactError is a no-op when VITE_SENTRY_DSN is unset at build time.
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    captureReactError(error, { componentStack: info.componentStack ?? '' });
  }

  private reset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  private reload = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="max-w-md text-sm text-muted-foreground">Reload the page.</p>
        {this.state.error?.message ? (
          <details className="max-w-xl text-left text-xs">
            <summary className="cursor-pointer text-muted-foreground">Details</summary>
            <pre className="mt-2 overflow-x-auto rounded bg-muted px-3 py-2">
              {this.state.error.message}
            </pre>
          </details>
        ) : null}
        <div className="flex gap-2">
          <Button onClick={this.reset} variant="outline">
            Try again
          </Button>
          <Button onClick={this.reload}>Reload page</Button>
        </div>
      </div>
    );
  }
}
