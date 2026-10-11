import { Component, type ReactNode } from "react";
import "./ErrorBoundary.css";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Short label shown before the error text (e.g. "Canvas" / "App"). */
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render errors below it so one bad view can't blank the window.
 * Shows a small themed message with the error text and a "Reload view"
 * button that retries the render. Logs via console.error.
 */
export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }): void {
    console.error(`ErrorBoundary[${this.props.label ?? "view"}]:`, error, info);
  }

  private reload = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error == null) return this.props.children;
    return (
      <div
        className="error-boundary"
        data-testid="error-boundary"
        role="alert"
      >
        <div className="error-boundary__card">
          <div className="error-boundary__title">
            Something went wrong{this.props.label ? ` in ${this.props.label}` : ""}
          </div>
          <div className="error-boundary__message">{String(error.message || error)}</div>
          <button
            type="button"
            className="error-boundary__button"
            onClick={this.reload}
          >
            Reload view
          </button>
        </div>
      </div>
    );
  }
}
