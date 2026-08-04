import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from './Icon';

interface ErrorBoundaryProps {
  children: ReactNode;
  label?: string;
  compact?: boolean;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Renderer] Unhandled component error', {
      label: this.props.label,
      message: error.message,
      componentStack: info.componentStack,
    });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        className={
          this.props.compact
            ? 'flex h-full min-h-32 flex-col items-center justify-center gap-2 bg-bg-secondary p-4 text-center'
            : 'flex h-screen flex-col items-center justify-center gap-3 bg-bg-primary p-8 text-center'
        }
        role="alert"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-severity-critical/30 bg-severity-critical/10 text-severity-critical">
          <Icon name="alert" size={20} />
        </span>
        <div>
          <p className="text-sm font-semibold text-text-primary">
            {this.props.label ?? 'Hexestra'} encountered a renderer error
          </p>
          <p className="mt-1 max-w-lg break-words font-mono text-2xs text-text-muted">
            {error.message}
          </p>
        </div>
        <button
          className="rounded border border-accent-blue/30 bg-accent-blue/10 px-3 py-1.5 text-xs text-accent-blue transition-colors hover:bg-accent-blue/20"
          onClick={() => window.location.reload()}
        >
          Reload workspace
        </button>
      </div>
    );
  }
}
