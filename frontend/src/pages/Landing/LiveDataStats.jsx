import { Activity, Globe2, Database, Clock } from 'lucide-react';
import DiamondSignStop from './DiamondSignStop';
import { useCountUp, useInView, useTilt } from '../../hooks/useLandingMotion';

function StatCard({ icon: Icon, tint, label, value, note, isNumeric = true }) {
  const [ref, inView] = useInView({ threshold: 0.05 });
  const [tiltRef, tiltStyle] = useTilt(3);

  const numericValue = typeof value === 'number' ? value : 0;
  const animatedNumber = useCountUp(numericValue, 1800, inView);

  const displayValue =
    value == null
      ? '—'
      : isNumeric
      ? inView
        ? animatedNumber.toLocaleString()
        : '0'
      : value;

  return (
    <div
      ref={tiltRef}
      style={tiltStyle}
      className="glass flex flex-col justify-between p-6 sm:p-7 shadow-glass hover:shadow-lift transition-all"
    >
      <div ref={ref}>
        <div
          className="mb-4 inline-grid h-12 w-12 place-items-center rounded-2xl shadow-clay-white"
          style={{ backgroundColor: `${tint}20`, color: tint }}
        >
          <Icon className="h-6 w-6" />
        </div>
        <p className="font-display text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
          {displayValue}
        </p>
        <p className="mt-2 text-base font-bold text-ink">{label}</p>
      </div>
      {note && <p className="mt-4 text-xs font-semibold text-ink-soft">{note}</p>}
    </div>
  );
}

export default function LiveDataStats({ stats, loading }) {
  return (
    <section id="live-data" className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <DiamondSignStop
        mood="yellow"
        badge="Stop 03 • Live Telemetry"
        title="Live platform indicators"
        subtitle="Unfiltered aggregates updated live from the real database. Cached safely with zero personal data."
      />

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Activity}
          tint="#2E9BFF"
          label="Total incidents analyzed"
          value={stats?.totalIncidents}
          note="Historical & citizen reports"
        />

        <StatCard
          icon={Globe2}
          tint="#2BD9A6"
          label="Countries & areas covered"
          value={stats?.areasCovered}
          note="Geocoded spatial zones"
        />

        <StatCard
          icon={Database}
          tint="#FFC93C"
          label="Datasets imported"
          value={stats?.datasetsImported}
          note="Multi-format collections"
        />

        <StatCard
          icon={Clock}
          tint="#FF4D6D"
          label="Most common incident hour"
          value={stats?.mostCommonHourFormatted ? `${stats.mostCommonHourFormatted}` : null}
          isNumeric={false}
          note="Local-time diurnal peak"
        />
      </div>
    </section>
  );
}
