export default function TechStack() {
  const techs = [
    { name: 'MongoDB 2dsphere', desc: 'Geospatial indexing' },
    { name: 'Express', desc: 'REST & ingestion backend' },
    { name: 'React 18', desc: 'Component architecture' },
    { name: 'Node.js', desc: 'Streaming runtime' },
    { name: 'FastAPI', desc: 'Python ML service' },
    { name: 'scikit-learn', desc: 'Random Forest & DBSCAN' },
    { name: 'Leaflet', desc: 'Interactive heat maps' },
    { name: 'Socket.IO', desc: 'Real-time sync' },
  ];

  return (
    <section
      aria-label="Technology stack"
      className="relative mx-auto max-w-6xl px-4 py-12 sm:px-6"
    >
      <div className="glass p-6 sm:p-8 text-center shadow-glass">
        <p className="font-display text-xs font-black uppercase tracking-widest text-ink-soft mb-4">
          Architectural Foundation
        </p>
        <h3 className="font-display text-2xl font-extrabold text-ink mb-6">
          Engineered for high-throughput spatial indexing
        </h3>

        <div className="flex flex-wrap items-center justify-center gap-3">
          {techs.map((t) => (
            <div
              key={t.name}
              className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/70 px-4 py-2 shadow-clay-white backdrop-blur-md transition-transform hover:-translate-y-0.5"
            >
              <span className="h-2 w-2 rounded-full bg-sun" />
              <span className="font-bold text-ink text-sm">{t.name}</span>
              <span className="text-xs text-ink-soft font-semibold border-l border-slate-300 pl-2">
                {t.desc}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
