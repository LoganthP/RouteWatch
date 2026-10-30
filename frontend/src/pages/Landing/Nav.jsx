import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X, ArrowRight, LayoutDashboard } from 'lucide-react';
import { Logo } from '../../components/Layout';
import { useAuth } from '../../context/AuthContext';

export default function Nav() {
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const links = [
    { href: '#features', label: 'Features' },
    { href: '#how-it-works', label: 'How it works' },
    { href: '#ai', label: 'AI' },
    { href: '#live-data', label: 'Live data' },
    { href: '#faq', label: 'FAQ' },
  ];

  const handleNavClick = () => {
    setMobileOpen(false);
  };

  return (
    <header className="sticky top-3 z-[1100] px-3 sm:px-6">
      <nav
        aria-label="RouteWatch Landing Navigation"
        className="glass-strong mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6"
      >
        <Link to="/" className="flex items-center gap-2 focus-visible:outline-sky" aria-label="RouteWatch Home">
          <Logo small />
        </Link>

        {/* Desktop links */}
        <div className="hidden items-center gap-7 md:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-semibold text-ink-soft transition-colors hover:text-ink focus-visible:outline-sky"
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* Desktop CTA actions */}
        <div className="hidden items-center gap-3 md:flex">
          {user ? (
            <Link
              to="/dashboard"
              className="clay-btn clay-btn-sm"
              aria-label="Open dashboard"
            >
              <LayoutDashboard className="h-4 w-4 mr-1.5" />
              Open dashboard
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="clay-btn-white clay-btn-sm"
                aria-label="Sign in to your account"
              >
                Sign in
              </Link>
              <Link
                to="/register"
                className="clay-btn clay-btn-sm"
                aria-label="Get started with RouteWatch"
              >
                Get started
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Link>
            </>
          )}
        </div>

        {/* Mobile menu toggle */}
        <button
          type="button"
          onClick={() => setMobileOpen(!mobileOpen)}
          className="grid h-10 w-10 place-items-center rounded-xl bg-white shadow-clay-white md:hidden"
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav-menu"
          aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
        >
          {mobileOpen ? <X className="h-5 w-5 text-ink" /> : <Menu className="h-5 w-5 text-ink" />}
        </button>
      </nav>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div
          id="mobile-nav-menu"
          className="glass-strong mt-2 mx-auto max-w-6xl p-5 md:hidden space-y-4"
        >
          <div className="flex flex-col gap-2.5">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={handleNavClick}
                className="rounded-xl px-3 py-2 text-base font-semibold text-ink hover:bg-white/60 transition-colors"
              >
                {link.label}
              </a>
            ))}
          </div>
          <div className="lane my-3 w-full opacity-60" />
          <div className="flex flex-col gap-2.5 pt-1">
            {user ? (
              <Link
                to="/dashboard"
                onClick={handleNavClick}
                className="clay-btn w-full py-2.5"
              >
                <LayoutDashboard className="h-4 w-4 mr-2" />
                Open dashboard
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  onClick={handleNavClick}
                  className="clay-btn-white w-full py-2.5 text-center"
                >
                  Sign in
                </Link>
                <Link
                  to="/register"
                  onClick={handleNavClick}
                  className="clay-btn w-full py-2.5 text-center"
                >
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
