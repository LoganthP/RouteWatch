import { Component } from 'react';
import { Link } from 'react-router-dom';
import { TriangleAlert } from 'lucide-react';

/** Catches render errors inside one page so the sidebar and other pages keep working. */
export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[RouteWatch] page crashed:', error, info?.componentStack); }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="glass mx-auto mt-6 max-w-xl p-7 text-center" role="alert">
        <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-3xl bg-coral-soft text-coral shadow-clay-white"><TriangleAlert className="h-7 w-7" /></span>
        <h2 className="text-2xl font-extrabold">This page hit a problem</h2>
        <p className="mt-2 text-ink-soft">The rest of RouteWatch still works. Try again, or go back to the dashboard.</p>
        <pre className="scroll-thin mt-4 max-h-32 overflow-auto rounded-2xl bg-white/70 p-3 text-left text-xs text-ink-soft">{String(this.state.error?.message || this.state.error)}</pre>
        <div className="mt-5 flex justify-center gap-3">
          <button className="clay-btn clay-btn-sm" onClick={() => this.setState({ error: null })}>Try again</button>
          <Link to="/" className="clay-btn-white clay-btn-sm" onClick={() => this.setState({ error: null })}>Go to dashboard</Link>
        </div>
      </div>
    );
  }
}
