import { FileUp, Cpu, LineChart, ShieldCheck } from 'lucide-react';
import DiamondSignStop from './DiamondSignStop';
import { useTilt } from '../../hooks/useLandingMotion';

function StepCard({ stepNumber, title, subtitle, desc, icon: Icon, tint, tag }) {
  const [tiltRef, tiltStyle] = useTilt(3);

  return (
    <div
      ref={tiltRef}
      style={tiltStyle}
      className="glass relative flex flex-col justify-between p-6 sm:p-7 shadow-glass hover:shadow-lift transition-all"
    >
      <div>
        <div className="mb-4 flex items-center justify-between">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-extrabold shadow-sm"
            style={{ backgroundColor: `${tint}25`, color: '#1E2A44' }}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tint }} />
            {tag}
          </span>
          <span className="font-display text-2xl font-black text-ink-faint">
            {stepNumber}
          </span>
        </div>

        <div
          className="mb-3 inline-grid h-12 w-12 place-items-center rounded-2xl shadow-clay-white"
          style={{ backgroundColor: `${tint}20`, color: tint }}
        >
          <Icon className="h-6 w-6" />
        </div>

        <h3 className="font-display text-xl font-bold text-ink">{title}</h3>
        <p className="mt-1 text-xs font-bold text-[#0f5ebb] uppercase tracking-wider">{subtitle}</p>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">{desc}</p>
      </div>

      <div className="lane mt-6 w-16 opacity-60" />
    </div>
  );
}

export default function HowItWorks() {
  const steps = [
    {
      stepNumber: '01',
      tag: 'Ingestion',
      title: 'Report or upload',
      subtitle: 'Field logs & bulk archives',
      desc: 'Citizens report local hazards from mobile web. Teams drop large multi-format files (CSV, Excel, GeoJSON, KML, GPX, ZIP) in resumable chunks without file size limits.',
      icon: FileUp,
      tint: '#2E9BFF',
    },
    {
      stepNumber: '02',
      tag: 'Processing',
      title: 'Map and clean',
      subtitle: '2dsphere normalization',
      desc: 'RouteWatch auto-maps schemas, deduplicates records with fingerprint keys, resolves IANA local timezones, and indexes coordinates on a 2dsphere geometry canvas.',
      icon: Cpu,
      tint: '#FFC93C',
    },
    {
      stepNumber: '03',
      tag: 'Intelligence',
      title: 'Analyse and forecast',
      subtitle: 'Statistical clustering & ML',
      desc: 'The engine isolates >2σ statistical hotspots, evaluates weekly rush-hour cycles, forecasts upcoming 7-day incident volumes, and predicts report severity with Random Forest models.',
      icon: LineChart,
      tint: '#2BD9A6',
    },
    {
      stepNumber: '04',
      tag: 'Resolution',
      title: 'Act on hotspots',
      subtitle: 'Interventions & verification',
      desc: 'Municipalities dispatch road patrols, traffic calming measures, and signage directly where risk concentrates. Changes and resolutions are permanently verified in the audit ledger.',
      icon: ShieldCheck,
      tint: '#9B8CFF',
    },
  ];

  return (
    <section id="how-it-works" className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <DiamondSignStop
        mood="yellow"
        badge="Stop 04 • The Journey"
        title="From raw coordinates to safer roads"
        subtitle="A transparent, step-by-step geospatial pipeline designed to turn messy traffic reports into preventative municipal action."
      />

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <StepCard key={s.stepNumber} {...s} />
        ))}
      </div>
    </section>
  );
}
