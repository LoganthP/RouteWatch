import { Link } from 'react-router-dom';
import { Logo } from '../../components/Layout';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="relative mx-auto max-w-6xl px-4 pt-10 pb-16 sm:px-6">
      {/* Lane-line dashes as a divider */}
      <div className="lane mb-10 w-full opacity-60" />

      <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
        <div className="flex flex-col items-center sm:items-start">
          <Link to="/" aria-label="RouteWatch Home">
            <Logo small />
          </Link>
          <p className="mt-2 text-xs font-semibold text-ink-soft text-center sm:text-left">
            AI-powered traffic-incident analytics and geospatial intelligence.
          </p>
        </div>

        <nav aria-label="Footer Navigation" className="flex flex-wrap items-center gap-6 text-sm font-semibold text-ink-soft">
          <a
            href="https://github.com/routewatch"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-ink transition-colors"
          >
            GitHub repo
          </a>
          <a
            href="#how-it-works"
            className="hover:text-ink transition-colors"
          >
            How it works
          </a>
          <a
            href="#faq"
            className="hover:text-ink transition-colors"
          >
            Docs / FAQ
          </a>
          <Link
            to="/login"
            className="hover:text-ink transition-colors"
          >
            Sign in
          </Link>
        </nav>
      </div>

      <div className="mt-8 flex flex-col items-center justify-between gap-4 border-t border-slate-200/60 pt-6 text-xs text-slate-600 sm:flex-row">
        <p>© {currentYear} RouteWatch. All rights reserved.</p>
        <p>Built with MongoDB 2dsphere geometry • OpenStreetMap tiles</p>
      </div>
    </footer>
  );
}
