import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPinned, UploadCloud, Activity, ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export default function Hero({ stats }) {
  const { user } = useAuth();
  const prefersReduced =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const mapHref = user ? '/map' : '/login?next=/map';
  const uploadHref = user ? '/report?tab=upload' : '/login?next=/report?tab=upload';

  const handleMouseMove = (e) => {
    if (prefersReduced) return;
    const { clientX, clientY } = e;
    const x = (clientX / window.innerWidth - 0.5) * 14;
    const y = (clientY / window.innerHeight - 0.5) * 14;
    setMousePos({ x, y });
  };

  const signs = [
    { x: 140, y: 220, color: '#FF4D6D', title: 'Problem', label: 'Accident' },
    { x: 300, y: 170, color: '#FFC93C', title: 'Insight', label: 'Hazard' },
    { x: 470, y: 110, color: '#2BD9A6', title: 'Action', label: 'Cleared' },
  ];

  return (
    <section
      onMouseMove={handleMouseMove}
      className="relative mx-auto max-w-6xl px-4 pt-10 pb-16 sm:px-6 sm:pt-16 sm:pb-20 lg:pt-20"
      aria-labelledby="hero-heading"
    >
      <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12">
        {/* Left Column: Headlines & CTAs */}
        <div className="lg:col-span-7">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3.5 py-1.5 text-xs font-bold text-sky-deep shadow-clay-white backdrop-blur-md mb-6">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-deep"></span>
            </span>
            Geospatial Intelligence Platform
          </div>

          <h1
            id="hero-heading"
            className="font-display text-4xl font-extrabold tracking-tight text-ink sm:text-5xl md:text-6xl lg:text-[3.85rem] lg:leading-[1.08]"
          >
            See where the world's <br className="hidden sm:inline" />
            <span className="lane-underline text-ink">roads keep going wrong.</span>
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft sm:text-xl">
            RouteWatch maps traffic incidents worldwide, pinpoints statistical hotspots,
            reveals temporal patterns, and forecasts road risks using MongoDB 2dsphere geometry.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              to={mapHref}
              className="clay-btn px-6 py-3.5 text-base shadow-clay"
              aria-label="Explore the live map"
            >
              <MapPinned className="h-5 w-5 mr-1" />
              Explore the live map
            </Link>

            <Link
              to={uploadHref}
              className="clay-btn-white px-6 py-3.5 text-base shadow-clay-white"
              aria-label="Upload a dataset"
            >
              <UploadCloud className="h-5 w-5 mr-1 text-sky" />
              Upload a dataset
            </Link>
          </div>

          <p className="mt-4 text-xs font-semibold text-ink-faint">
            Supports CSV, Excel, GeoJSON, KML, GPX, PDF, and ZIP • Resumable chunked ingestion
          </p>
        </div>

        {/* Right Column: Extended Interactive Road Illustration */}
        <div className="relative lg:col-span-5">
          <div
            style={
              prefersReduced
                ? {}
                : {
                    transform: `translate3d(${mousePos.x}px, ${mousePos.y}px, 0)`,
                    transition: 'transform 0.15s ease-out',
                  }
            }
            className="relative overflow-hidden rounded-[36px] border border-white/80 bg-gradient-to-br from-[#8CCBFF] via-[#B9E2FF] to-[#FFE79A] p-6 shadow-lift"
          >
            {/* Ambient Badge */}
            <div className="relative z-10 flex items-center justify-between">
              <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-bold text-ink shadow-clay-white backdrop-blur-md">
                Live Spatial Model
              </span>
              <span className="flex items-center gap-1.5 text-xs font-bold text-ink/75">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                2dsphere Active
              </span>
            </div>

            {/* Road SVG */}
            <div className="relative mt-4 h-[340px] w-full">
              <svg
                viewBox="0 0 600 360"
                className="h-full w-full overflow-visible"
                aria-label="Interactive road visualization showing traffic incident signs"
                role="img"
              >
                {/* Diagonal Winding Road Surface */}
                <path
                  d="M-30 360 C 140 260, 240 230, 640 80 L 640 180 C 310 290, 200 310, 80 370 Z"
                  fill="#3B4A6B"
                  stroke="#1E2A44"
                  strokeWidth="3"
                />

                {/* Yellow Dashed Center Lane */}
                <path
                  d="M20 360 C 180 270, 280 240, 640 130"
                  fill="none"
                  stroke="#FFC93C"
                  strokeWidth="6"
                  strokeDasharray="26 18"
                  strokeLinecap="round"
                />

                {/* Road Signs Dropping onto Posts */}
                {signs.map((sign, idx) => (
                  <g key={sign.color} transform={`translate(${sign.x} ${sign.y - 70})`}>
                    {/* Metal Post */}
                    <rect x="-3" y="30" width="6" height="42" rx="3" fill="#1E2A44" />
                    {/* Dropping Diamond Sign */}
                    <g
                      style={{
                        animation: prefersReduced
                          ? 'none'
                          : `dropSign 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) ${0.35 + idx * 0.25}s both`,
                      }}
                    >
                      <rect
                        x="-20"
                        y="-4"
                        width="40"
                        height="40"
                        rx="7"
                        transform="rotate(45 0 16)"
                        fill={sign.color}
                        stroke="#1E2A44"
                        strokeWidth="4"
                      />
                      {/* Inner dot symbol */}
                      <circle cx="0" cy="16" r="4.5" fill="#1E2A44" />
                    </g>
                  </g>
                ))}

                {/* Pulsing Incident Pin on the Road */}
                <g transform="translate(240, 245)">
                  {/* Pulse wave */}
                  <circle
                    cx="0"
                    cy="0"
                    r="16"
                    fill="#FF4D6D"
                    opacity={0.3}
                    style={{
                      animation: prefersReduced ? 'none' : 'pulseIncident 2.2s ease-in-out infinite',
                    }}
                  />
                  {/* Pin body */}
                  <path
                    d="M0 -22 C -8 -22, -14 -16, -14 -8 C -14 4, 0 18, 0 18 C 0 18, 14 4, 14 -8 C 14 -16, 8 -22, 0 -22 Z"
                    fill="#FF4D6D"
                    stroke="#1E2A44"
                    strokeWidth="2.5"
                    filter="drop-shadow(0 4px 6px rgba(30,42,68,0.4))"
                  />
                  <circle cx="0" cy="-9" r="4.5" fill="#ffffff" />
                </g>
              </svg>

              {/* Floating Live Stat Glass Card */}
              <div
                style={{
                  animation: prefersReduced
                    ? 'none'
                    : 'floatIn 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) 0.8s both',
                }}
                className="glass-strong absolute -bottom-3 -left-2 sm:left-4 z-20 max-w-[240px] p-3.5 shadow-lift"
              >
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-sky text-white shadow-clay">
                    <Activity className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">
                      Live Incident Base
                    </p>
                    <p className="font-display text-xl font-extrabold text-ink leading-tight">
                      {stats?.totalIncidents != null
                        ? Number(stats.totalIncidents).toLocaleString()
                        : '30,055'}
                    </p>
                  </div>
                </div>
                <p className="mt-1 text-[11px] font-semibold text-ink-soft">
                  Verified & mapped across {stats?.areasCovered || 127} global sectors
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
