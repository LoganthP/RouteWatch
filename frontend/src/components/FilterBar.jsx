import { useEffect, useState } from 'react';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import api from '../api/client';
import { SEVERITIES, SEV_COLOR, STATUSES, TYPES } from '../lib/constants';

function ChipGroup({ label, options, values, onToggle, dot }) {
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o} type="button" data-on={values.includes(o)} aria-pressed={values.includes(o)} onClick={() => onToggle(o)} className="neu-chip inline-flex items-center gap-1.5">
            {dot && <span className="h-2 w-2 rounded-full" style={{ background: dot[o] }} />}
            {o}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Shared filter panel used by the map, analytics, incidents and AI pages. */
export default function FilterBar({ value, onChange, compact, showStatus = true, showSearch = false, defaultOpen }) {
  const [areas, setAreas] = useState([]);
  const [datasets, setDatasets] = useState([]);
  const [open, setOpen] = useState(defaultOpen ?? !compact);

  useEffect(() => {
    api.get('/areas', { params: { limit: 300 } }).then((r) => setAreas(Array.isArray(r.data) ? r.data.map((a) => a.name).filter(Boolean).sort() : [])).catch(() => {});
    api.get('/datasets').then((r) => setDatasets(Array.isArray(r.data) ? r.data.filter((d) => ['completed', 'stopped', 'cancelled'].includes(d.status)) : [])).catch(() => {});
  }, []);

  const toggle = (key) => (v) => onChange({ ...value, [key]: value[key].includes(v) ? value[key].filter((x) => x !== v) : [...value[key], v] });
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value });
  const active = value.type.length + value.severity.length + value.status.length + (value.area ? 1 : 0) + (value.dataset ? 1 : 0) + (value.from ? 1 : 0) + (value.to ? 1 : 0);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-2 font-display text-lg font-bold" aria-expanded={open}>
          <SlidersHorizontal className="h-5 w-5 text-sky" />
          Filters
          {active > 0 && <span className="rounded-full bg-sun px-2 py-0.5 text-xs font-bold text-ink">{active}</span>}
        </button>
        {active > 0 && (
          <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-sky-deep hover:underline"
            onClick={() => onChange({ ...value, type: [], severity: [], status: [], area: '', dataset: '', from: '', to: '' })}>
            <RotateCcw className="h-4 w-4" /> Clear
          </button>
        )}
      </div>

      {open && (
        <div className={`mt-4 grid gap-5 ${compact ? '' : 'lg:grid-cols-2 xl:grid-cols-[1.1fr_1fr]'}`}>
          {showSearch && (
            <div className={compact ? '' : 'lg:col-span-2'}>
              <label className="label" htmlFor="f-search">Search</label>
              <input id="f-search" className="neu-field" placeholder="Incident ID, description or area" value={value.search} onChange={set('search')} />
            </div>
          )}
          <ChipGroup label="Incident type" options={TYPES} values={value.type} onToggle={toggle('type')} />
          <ChipGroup label="Severity" options={SEVERITIES} values={value.severity} onToggle={toggle('severity')} dot={SEV_COLOR} />
          {showStatus && <ChipGroup label="Status" options={STATUSES} values={value.status} onToggle={toggle('status')} />}
          <div className={`grid gap-3 ${compact ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'}`}>
            <div className="col-span-2 sm:col-span-1">
              <label className="label" htmlFor="f-dataset">Dataset</label>
              <select id="f-dataset" className="neu-field" value={value.dataset} onChange={set('dataset')}>
                <option value="">All data</option>
                <option value="none">Reported and seeded only</option>
                {datasets.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
              </select>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="label" htmlFor="f-area">Area</label>
              <select id="f-area" className="neu-field" value={value.area} onChange={set('area')}>
                <option value="">All areas</option>
                {areas.map((a) => <option key={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="f-from">From</label>
              <input id="f-from" type="date" className="neu-field px-3 text-sm" value={value.from} onChange={set('from')} />
            </div>
            <div>
              <label className="label" htmlFor="f-to">To</label>
              <input id="f-to" type="date" className="neu-field px-3 text-sm" value={value.to} onChange={set('to')} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
