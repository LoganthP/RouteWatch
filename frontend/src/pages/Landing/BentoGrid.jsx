import { lazy, Suspense, useEffect, useState } from 'react';
import {
  Flame,
  Upload,
  CalendarClock,
  Radar,
  Terminal,
  ShieldCheck,
  Check,
  FileText,
  Clock,
  Sparkles,
} from 'lucide-react';
import DiamondSignStop from './DiamondSignStop';
import { useInView, useTilt } from '../../hooks/useLandingMotion';
import { Spinner } from '../../components/ui';

// Lazy load the Leaflet mini map chunk only when this section is in view
const MiniHotspotMap = lazy(() => import('./MiniHotspotMap'));

export default function BentoGrid() {
  const [mapContainerRef, isMapInView] = useInView({ threshold: 0.1 });
  const [bentoRef, isBentoInView] = useInView({ threshold: 0.05 });

  // 1. Upload animation state
  const [uploadIndex, setUploadIndex] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(35);
  const files = [
    { name: 'metro_accidents_2026.csv', size: '24.8 MB', chunks: '12/12' },
    { name: 'highway_hazards.geojson', size: '112.4 MB', chunks: '28/40' },
    { name: 'traffic_patrol_log.xlsx', size: '8.2 MB', chunks: '4/4' },
    { name: 'city_dispatch_q3.zip', size: '340.0 MB', chunks: '85/120' },
  ];

  useEffect(() => {
    if (!isBentoInView) return;
    const timer = setInterval(() => {
      setUploadProgress((p) => {
        if (p >= 100) {
          setUploadIndex((i) => (i + 1) % files.length);
          return 10;
        }
        return p + 15;
      });
    }, 1200);
    return () => clearInterval(timer);
  }, [isBentoInView, files.length]);

  // 2. Query Lab Typewriter
  const [queryCharIndex, setQueryCharIndex] = useState(0);
  const fullQuery = 'db.incidents.find({ location: { $nearSphere: { $maxDistance: 2500 } } })';

  useEffect(() => {
    if (!isBentoInView) return;
    const interval = setInterval(() => {
      setQueryCharIndex((prev) => (prev < fullQuery.length ? prev + 1 : fullQuery.length));
    }, 60);
    return () => clearInterval(interval);
  }, [isBentoInView, fullQuery.length]);

  // Tilt refs for individual bento cards
  const [tilt1, style1] = useTilt(3);
  const [tilt2, style2] = useTilt(3);
  const [tilt3, style3] = useTilt(3);
  const [tilt4, style4] = useTilt(3);
  const [tilt5, style5] = useTilt(3);
  const [tilt6, style6] = useTilt(3);

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <section id="features" ref={bentoRef} className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <DiamondSignStop
        mood="yellow"
        badge="Stop 02 • Core Engine"
        title="Purpose-built for road safety intelligence"
        subtitle="Every capability in RouteWatch is engineered around real geospatial coordinates, statistical rigor, and immediate operational clarity."
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
        {/* BENTO CARD 1: Hotspot Map (7 Cols) */}
        <div
          ref={tilt1}
          style={style1}
          className="glass flex flex-col justify-between p-6 sm:p-7 md:col-span-12 lg:col-span-7 shadow-glass hover:shadow-lift transition-all"
        >
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-coral-soft px-3 py-1 text-xs font-bold text-coral">
                <Flame className="h-3.5 w-3.5" /> Hotspot Detection
              </span>
              <span className="text-xs font-semibold text-ink-soft">2dsphere Grid</span>
            </div>
            <h3 className="font-display text-2xl font-bold text-ink">
              Statistical Hotspot Clustering
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Automatically calculates variance across spatial grid cells to flag collision
              clusters exceeding 2 standard deviations above the average baseline.
            </p>
          </div>

          <div ref={mapContainerRef} className="mt-5 h-64 w-full overflow-hidden rounded-2xl border border-white/60 bg-sky-soft/40 shadow-inner">
            {isMapInView ? (
              <Suspense
                fallback={
                  <div className="grid h-full place-items-center">
                    <Spinner label="Loading live map..." />
                  </div>
                }
              >
                <MiniHotspotMap />
              </Suspense>
            ) : (
              <div className="grid h-full place-items-center text-sm font-semibold text-ink-soft">
                <span>Scroll to preview live hotspot layer</span>
              </div>
            )}
          </div>
        </div>

        {/* BENTO CARD 2: Upload Any Dataset (5 Cols) */}
        <div
          ref={tilt2}
          style={style2}
          className="glass flex flex-col justify-between p-6 sm:p-7 md:col-span-12 lg:col-span-5 shadow-glass hover:shadow-lift transition-all"
        >
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sun-soft px-3 py-1 text-xs font-bold text-sun-deep">
                <Upload className="h-3.5 w-3.5" /> Multi-Format Ingestion
              </span>
              <span className="text-xs font-semibold text-ink-soft">Resumable</span>
            </div>
            <h3 className="font-display text-2xl font-bold text-ink">
              Ingest Any Dataset
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              CSV, Excel, GeoJSON, KML, GPX, PDF, and ZIP archives stream in resumable binary chunks
              with automatic header mapping and geometry parsing.
            </p>
          </div>

          {/* Animated Upload Simulator */}
          <div className="mt-5 rounded-2xl border-2 border-dashed border-sky/40 bg-white/50 p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky text-white shadow-clay">
                <FileText className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-ink">
                  {files[uploadIndex].name}
                </p>
                <p className="text-[11px] font-semibold text-ink-soft">
                  {files[uploadIndex].size} • Chunks {files[uploadIndex].chunks}
                </p>
              </div>
              <span className="text-xs font-extrabold text-sky-deep">
                {uploadProgress}%
              </span>
            </div>

            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#E5EEF8]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky to-mint transition-all duration-300 ease-out"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-[10px] font-semibold text-ink-soft">
              <span>CRC32 deduplication</span>
              <span className="text-mint-deep font-bold">Resumable stream</span>
            </div>
          </div>
        </div>

        {/* BENTO CARD 3: Time Patterns (5 Cols) */}
        <div
          ref={tilt3}
          style={style3}
          className="glass flex flex-col justify-between p-6 sm:p-7 md:col-span-12 lg:col-span-5 shadow-glass hover:shadow-lift transition-all"
        >
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-mint-soft px-3 py-1 text-xs font-bold text-mint-deep">
                <CalendarClock className="h-3.5 w-3.5" /> Temporal Heat Grid
              </span>
              <span className="text-xs font-semibold text-ink-soft">168-hr Matrix</span>
            </div>
            <h3 className="font-display text-2xl font-bold text-ink">
              Time Patterns
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Every incident is evaluated in its local coordinates' IANA time zone, exposing
              rush-hour danger periods across weekdays and weekends.
            </p>
          </div>

          {/* Mini 7x12 interactive heat grid */}
          <div className="mt-5 rounded-2xl bg-white/70 p-3.5 shadow-neu-in">
            <div className="flex justify-between text-[10px] font-bold text-ink-soft mb-1.5 px-6">
              <span>Morning</span>
              <span>Afternoon</span>
              <span>Evening Rush</span>
            </div>
            <div className="space-y-1.5">
              {days.map((day, dIdx) => (
                <div key={day} className="flex items-center gap-2">
                  <span className="w-6 text-[10px] font-bold text-ink-soft">{day}</span>
                  <div className="grid flex-1 grid-cols-12 gap-1">
                    {Array.from({ length: 12 }).map((_, hIdx) => {
                      // Intensities higher on Friday/Saturday evenings
                      const isHot = (dIdx === 4 || dIdx === 5) && hIdx >= 8 && hIdx <= 10;
                      const isMed = hIdx === 4 || hIdx === 8 || hIdx === 9;
                      const bg = isHot
                        ? '#FF4D6D'
                        : isMed
                        ? '#FFC93C'
                        : hIdx % 3 === 0
                        ? '#DCEEFF'
                        : '#EDF4FC';
                      return (
                        <div
                          key={hIdx}
                          title={`${day} ${(hIdx * 2).toString().padStart(2, '0')}:00`}
                          className="h-3.5 rounded-[3px] transition-transform hover:scale-125"
                          style={{ backgroundColor: bg }}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* BENTO CARD 4: Nearby Proximity Radar (7 Cols) */}
        <div
          ref={tilt4}
          style={style4}
          className="glass flex flex-col justify-between p-6 sm:p-7 md:col-span-12 lg:col-span-7 shadow-glass hover:shadow-lift transition-all"
        >
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-soft px-3 py-1 text-xs font-bold text-sky-deep">
                <Radar className="h-3.5 w-3.5" /> Spherical Proximity
              </span>
              <span className="text-xs font-semibold text-ink-soft">$geoNear</span>
            </div>
            <h3 className="font-display text-2xl font-bold text-ink">
              Nearby Radial Search
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Pin any latitude and longitude to scan outward in precise geodesic rings,
              ranking nearest incidents by distance in meters.
            </p>
          </div>

          {/* Animated Radar Visual */}
          <div className="relative mt-5 flex h-48 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-b from-[#1E2A44] to-[#2B3A5A] p-4 text-white">
            {/* Concentric rings */}
            <div className="absolute h-24 w-24 rounded-full border border-sky/30" />
            <div className="absolute h-36 w-36 rounded-full border border-sky/20" />
            <div className="absolute h-44 w-44 rounded-full border border-sky/10" />

            {/* Expanding pulse ring */}
            <div className="absolute h-36 w-36 rounded-full border-2 border-sun animate-ping opacity-60 pointer-events-none" />

            {/* Center Pin */}
            <div className="relative z-10 grid h-8 w-8 place-items-center rounded-full bg-sun text-ink font-bold shadow-clay-sun">
              <span className="h-3 w-3 rounded-full bg-ink" />
            </div>

            {/* Floating nearby incident markers */}
            <div className="absolute left-10 top-8 flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] backdrop-blur-md">
              <span className="h-2 w-2 rounded-full bg-coral" />
              <span>Accident • 310m</span>
            </div>

            <div className="absolute right-12 bottom-8 flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] backdrop-blur-md">
              <span className="h-2 w-2 rounded-full bg-sun" />
              <span>Hazard • 720m</span>
            </div>
          </div>
        </div>

        {/* BENTO CARD 5: Query Lab (6 Cols) */}
        <div
          ref={tilt5}
          style={style5}
          className="glass flex flex-col justify-between p-6 sm:p-7 md:col-span-12 lg:col-span-6 shadow-glass hover:shadow-lift transition-all"
        >
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-lilac-soft px-3 py-1 text-xs font-bold text-lilac">
                <Terminal className="h-3.5 w-3.5" /> Query Lab
              </span>
              <span className="text-xs font-semibold text-ink-soft">Raw GeoJSON</span>
            </div>
            <h3 className="font-display text-2xl font-bold text-ink">
              Geospatial Query Console
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Test queries against live MongoDB 2dsphere indexes using $geoWithin polygons,
              $geoNear, and composite bounding boxes.
            </p>
          </div>

          {/* Terminal Box */}
          <div className="mt-5 overflow-hidden rounded-2xl bg-[#1E2A44] p-4 text-left font-mono text-xs shadow-lift text-slate-200">
            <div className="mb-2 flex items-center gap-1.5 text-slate-400 border-b border-white/10 pb-2">
              <span className="h-2.5 w-2.5 rounded-full bg-coral inline-block" />
              <span className="h-2.5 w-2.5 rounded-full bg-sun inline-block" />
              <span className="h-2.5 w-2.5 rounded-full bg-mint inline-block" />
              <span className="ml-2 text-[10px] text-slate-400">query-lab@routewatch:~</span>
            </div>
            <p className="text-sun">
              &gt; {fullQuery.slice(0, queryCharIndex)}
              <span className="animate-pulse">_</span>
            </p>
            <div className="mt-3 rounded-lg bg-black/40 p-2 text-[11px] text-emerald-400">
              ✓ 2dsphere index hit • 14 records returned in 9ms
            </div>
          </div>
        </div>

        {/* BENTO CARD 6: Roles & Audit Log (6 Cols) */}
        <div
          ref={tilt6}
          style={style6}
          className="glass flex flex-col justify-between p-6 sm:p-7 md:col-span-12 lg:col-span-6 shadow-glass hover:shadow-lift transition-all"
        >
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-soft px-3 py-1 text-xs font-bold text-sky-deep">
                <ShieldCheck className="h-3.5 w-3.5" /> Governance
              </span>
              <span className="text-xs font-semibold text-ink-soft">Admin & Citizen</span>
            </div>
            <h3 className="font-display text-2xl font-bold text-ink">
              Dual Roles & Immutable Audit
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Citizens submit field observations; administrators verify reports, run ML models,
              and manage datasets with every modification logged.
            </p>
          </div>

          {/* Roles & Audit Preview */}
          <div className="mt-5 space-y-2.5 rounded-2xl bg-white/70 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <span className="rounded-full bg-sky px-2.5 py-0.5 text-[11px] font-bold text-white">
                  Admin
                </span>
                <span className="rounded-full bg-mint-soft px-2.5 py-0.5 text-[11px] font-bold text-mint-deep">
                  Citizen
                </span>
              </div>
              <span className="text-[11px] font-bold text-ink-soft">Append-only log</span>
            </div>

            <div className="space-y-2 pt-1 border-t border-slate-200">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-ink flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-mint-deep" /> Verified INC-00482
                </span>
                <span className="text-ink-soft text-[11px]">3m ago</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-ink flex items-center gap-1.5">
                  <Upload className="h-3.5 w-3.5 text-sky" /> Imported 12,400 rows
                </span>
                <span className="text-ink-soft text-[11px]">18m ago</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
