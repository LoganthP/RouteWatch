import { FileSpreadsheet, MapPinOff, ClockAlert, CheckCircle2 } from 'lucide-react';
import DiamondSignStop from './DiamondSignStop';
import { useTilt } from '../../hooks/useLandingMotion';

function ProblemCard({ icon: Icon, title, desc, delay = '' }) {
  const [tiltRef, tiltStyle] = useTilt(3);

  return (
    <div
      ref={tiltRef}
      style={tiltStyle}
      className="glass flex flex-col justify-between p-6 sm:p-7 shadow-glass transition-all hover:shadow-lift"
    >
      <div>
        <div className="mb-4 inline-grid h-12 w-12 place-items-center rounded-2xl bg-coral-soft text-coral shadow-clay-white">
          <Icon className="h-6 w-6" />
        </div>
        <h3 className="font-display text-xl font-bold text-ink">{title}</h3>
        <p className="mt-2.5 text-sm leading-relaxed text-ink-soft">{desc}</p>
      </div>
      <div className="mt-5 flex items-center gap-2 text-xs font-bold text-[#c91a3c]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#c91a3c]" />
        Data friction point
      </div>
    </div>
  );
}

export default function ProblemSolution() {
  const problems = [
    {
      icon: FileSpreadsheet,
      title: 'Scattered Across Silos',
      desc: 'Accident records, police logs, and road hazard reports sit fragmented across CSVs, Excel files, shapefiles, and paper PDFs across disparate city departments.',
    },
    {
      icon: MapPinOff,
      title: 'Unmapped & Impassable',
      desc: 'Raw latitudes and longitudes hide recurring collision clusters. Spreadsheets give no spatial context on which corridors or intersections fail repeatedly.',
    },
    {
      icon: ClockAlert,
      title: 'Reactive Instead of Predictive',
      desc: 'Safety interventions happen after recurring collisions occur. Without temporal analysis and machine learning, hazard spikes take teams by surprise.',
    },
  ];

  return (
    <section id="problem-solution" className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <DiamondSignStop
        mood="red"
        badge="Stop 01 • The Problem"
        title="Why traffic safety data fails teams today"
        subtitle="Most municipalities and safety researchers possess mountains of incident records, yet struggle to convert them into timely roadway interventions."
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {problems.map((p) => (
          <ProblemCard key={p.title} {...p} />
        ))}
      </div>

      {/* The RouteWatch Fix */}
      <div className="mt-8 rounded-[28px] border border-white bg-gradient-to-r from-white/90 via-sky-soft/60 to-white/90 p-6 sm:p-8 shadow-glass text-center">
        <div className="mx-auto flex max-w-3xl flex-col items-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-mint-soft px-3 py-1 text-xs font-bold text-mint-deep mb-3">
            <CheckCircle2 className="h-4 w-4 text-mint-deep" /> The RouteWatch Solution
          </span>
          <p className="font-display text-lg font-bold leading-relaxed text-ink sm:text-xl md:text-2xl">
            RouteWatch cleans and geocodes heterogeneous datasets, indexes coordinates with
            MongoDB 2dsphere geometry, and applies predictive intelligence to transform raw logs
            into clear, actionable road safety insights.
          </p>
        </div>
      </div>
    </section>
  );
}
