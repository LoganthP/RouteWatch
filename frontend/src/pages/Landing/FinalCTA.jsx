import { Link } from 'react-router-dom';
import { ArrowRight, LayoutDashboard, Flag } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTilt } from '../../hooks/useLandingMotion';

export default function FinalCTA() {
  const { user } = useAuth();
  const [tiltRef, tiltStyle] = useTilt(2.5);

  return (
    <section className="relative mx-auto max-w-5xl px-4 py-20 sm:px-6 text-center">
      <div
        ref={tiltRef}
        style={tiltStyle}
        className="glass relative overflow-hidden p-8 sm:p-14 shadow-lift"
      >
        {/* Road finish banner line */}
        <div className="absolute top-0 inset-x-0 h-3 bg-repeating-linear-gradient-sun lane" />

        <div className="mx-auto max-w-2xl">
          <div className="mx-auto mb-4 inline-grid h-14 w-14 place-items-center rounded-3xl bg-sun text-ink shadow-clay-sun">
            <Flag className="h-7 w-7" />
          </div>

          <h2 className="font-display text-3xl font-extrabold tracking-tight text-ink sm:text-5xl">
            Start watching your roads
          </h2>

          <p className="mt-4 text-base leading-relaxed text-ink-soft sm:text-lg">
            Import your collision archives, map citizen reports in real-time, and uncover
            the high-risk corridors that standard spreadsheets miss.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            {user ? (
              <Link
                to="/dashboard"
                className="clay-btn px-7 py-3.5 text-base shadow-clay"
                aria-label="Open your RouteWatch dashboard"
              >
                <LayoutDashboard className="h-5 w-5 mr-1.5" />
                Open dashboard
              </Link>
            ) : (
              <>
                <Link
                  to="/register"
                  className="clay-btn px-7 py-3.5 text-base shadow-clay"
                  aria-label="Get started with RouteWatch"
                >
                  Get started
                  <ArrowRight className="h-4 w-4 ml-1.5" />
                </Link>
                <Link
                  to="/login"
                  className="clay-btn-white px-7 py-3.5 text-base shadow-clay-white"
                  aria-label="Sign in to your account"
                >
                  Sign in
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Finishing lane mark */}
        <div className="lane mx-auto mt-10 w-48 opacity-80" />
      </div>
    </section>
  );
}

