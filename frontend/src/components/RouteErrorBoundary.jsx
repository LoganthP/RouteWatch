import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, LayoutDashboard, RotateCcw } from 'lucide-react';
import { ClayButton } from './ui';

export class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('Route error caught by RouteErrorBoundary:', error, errorInfo?.componentStack);
  }

  reset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[400px] w-full items-center justify-center p-6">
          <div className="glass max-w-xl w-full rounded-3xl p-6 sm:p-8 shadow-clay text-ink space-y-5">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-coral-soft text-coral shadow-clay-white">
                <AlertTriangle className="h-6 w-6" />
              </span>
              <div>
                <h2 className="text-xl font-extrabold text-ink">Page Error</h2>
                <p className="text-xs font-semibold text-ink-soft">
                  An error occurred while loading this view, but the rest of RouteWatch is still running.
                </p>
              </div>
            </div>

            <div className="rounded-2xl bg-white/70 p-4 border border-coral/20">
              <p className="text-xs font-bold text-coral mb-1">Error Details:</p>
              <pre className="text-xs font-mono text-ink-soft whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                {this.state.error?.message || 'Unknown runtime error'}
              </pre>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <ClayButton size="sm" variant="sky" onClick={this.reset}>
                <RotateCcw className="h-4 w-4" /> Try again
              </ClayButton>
              <Link to="/">
                <ClayButton size="sm" variant="white" onClick={this.reset}>
                  <LayoutDashboard className="h-4 w-4 text-sky" /> Go to dashboard
                </ClayButton>
              </Link>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default RouteErrorBoundary;
