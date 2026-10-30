export default function DiamondSignStop({
  mood = 'yellow', // 'red' | 'yellow' | 'green'
  badge,
  title,
  subtitle,
}) {
  const colorMap = {
    red: { fill: '#FF4D6D', soft: '#FFE1E7', border: '#1E2A44', label: 'Problem' },
    yellow: { fill: '#FFC93C', soft: '#FFF3CC', border: '#1E2A44', label: 'Capability' },
    green: { fill: '#2BD9A6', soft: '#D7F8EE', border: '#1E2A44', label: 'Outcome' },
  };

  const conf = colorMap[mood] || colorMap.yellow;

  return (
    <div className="mb-10 flex flex-col items-center text-center">
      {/* Road Sign on Post */}
      <div className="relative mb-4 flex flex-col items-center">
        {/* Diamond sign */}
        <div className="relative grid h-12 w-12 place-items-center">
          <div
            className="absolute inset-1 rotate-45 rounded-[9px] border-[3.5px] border-ink shadow-clay"
            style={{ backgroundColor: conf.fill }}
          />
          {/* Sign symbol */}
          <span className="relative z-10 text-xs font-black uppercase text-ink tracking-tight">
            !
          </span>
        </div>
        {/* Sign post */}
        <div className="h-6 w-2 rounded-b bg-ink shadow-sm" />
      </div>

      {badge && (
        <span
          className="rounded-full px-3 py-1 text-xs font-bold shadow-clay-white mb-2"
          style={{ backgroundColor: conf.soft, color: '#1E2A44' }}
        >
          {badge}
        </span>
      )}

      {title && (
        <h2 className="font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          {title}
        </h2>
      )}

      {subtitle && (
        <p className="mt-2.5 max-w-2xl text-base text-ink-soft sm:text-lg">
          {subtitle}
        </p>
      )}

      <div className="lane my-4 w-28 opacity-80" />
    </div>
  );
}
