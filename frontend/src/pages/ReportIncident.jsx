import { useEffect, useState } from 'react';
import { Marker } from 'react-leaflet';
import { motion } from 'framer-motion';
import { BrainCircuit, CheckCircle2, LocateFixed, MapPin } from 'lucide-react';
import api, { errMsg } from '../api/client';
import useApi, { useDebounced } from '../lib/useApi';
import { BaseMap, ClickToPick, FitBounds, FlyTo, MapToolbar, pickIcon } from '../components/MapParts';
import { ClayButton, ErrorBanner, PageHeader, Segmented } from '../components/ui';
import UploadWizard from '../components/UploadWizard';
import DatasetsPanel from '../components/DatasetsPanel';
import { SEVERITIES, SEV_COLOR, SEV_SOFT, STATUSES, TYPES, TYPE_META } from '../lib/constants';
import { isLatLng, safeFixed } from '../lib/safe';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const blank = () => ({ type: 'Accident', severity: 'Medium', description: '', reportedAt: nowLocal(), status: 'Verified' });

function SingleReport() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const extent = useApi('/analytics/bounds');
  const [pos, setPos] = useState(null);
  const [fly, setFly] = useState(null);
  const [form, setForm] = useState(blank());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const [ai, setAi] = useState(null); // { severity, confidence } | { off: message }

  // ask the trained model for a severity suggestion while the user fills the form
  const query = useDebounced(pos && form.type && form.reportedAt ? JSON.stringify({ pos, type: form.type, t: form.reportedAt }) : '', 500);
  useEffect(() => {
    if (!query) { setAi(null); return undefined; }
    let alive = true;
    const q = JSON.parse(query);
    api.post('/ml/severity/predict', { lat: q.pos[0], lng: q.pos[1], type: q.type, datetime: new Date(q.t).toISOString() })
      .then((r) => alive && setAi(r.data))
      .catch((e) => alive && setAi({ off: errMsg(e) }));
    return () => { alive = false; };
  }, [query]);

  const locate = () => {
    setError('');
    if (!navigator.geolocation) return setError('This browser cannot share your location. Click the map instead.');
    return navigator.geolocation.getCurrentPosition(
      (p) => { const c = [p.coords.latitude, p.coords.longitude]; if (isLatLng(c)) { setPos(c); setFly(c); } },
      () => setError('Location permission was denied. Click the road on the map instead.')
    );
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!isLatLng(pos)) return setError('Click the map to mark where the incident happened.');
    const when = new Date(form.reportedAt);
    if (isNaN(when)) return setError('Choose a valid date and time.');
    setBusy(true); setError('');
    try {
      const body = {
        type: form.type, severity: form.severity, description: form.description,
        reportedAt: when.toISOString(),
        location: { type: 'Point', coordinates: [pos[1], pos[0]] }, // [lng, lat]
        ...(ai?.severity ? { aiSeverity: ai.severity } : {}),
        ...(isAdmin ? { status: form.status } : {}),
      };
      const { data } = await api.post('/incidents', body);
      setDone(data);
      toast(`Incident ${data.incidentId} reported`);
      setForm(blank()); setPos(null); setAi(null);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {done && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          className="mb-5 flex flex-wrap items-center gap-3 rounded-3xl bg-mint-soft px-5 py-4 shadow-clay-white">
          <CheckCircle2 className="h-6 w-6 text-mint-deep" />
          <p className="font-semibold">
            {done.incidentId} was saved in {done.area}.{' '}
            {done.status === 'Pending' ? 'An administrator will verify it before it counts as confirmed.' : `Status: ${done.status}.`}
          </p>
          <button className="ml-auto text-sm font-bold text-mint-deep hover:underline" onClick={() => setDone(null)}>Dismiss</button>
        </motion.div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        <div className="glass relative min-w-0 overflow-hidden p-2">
          <BaseMap className="h-[460px] w-full rounded-[22px] xl:h-full xl:min-h-[600px]">
            {!pos && extent.data?.bbox && <FitBounds bbox={extent.data.bbox} maxZoom={13} />}
            <MapToolbar className="absolute bottom-6 left-5 z-[1000]" />
            <ClickToPick onPick={(c) => isLatLng(c) && setPos(c)} />
            {fly && <FlyTo center={fly} zoom={16} />}
            {isLatLng(pos) && <Marker position={pos} icon={pickIcon} draggable eventHandlers={{ dragend: (e) => { const ll = e.target.getLatLng(); setPos([ll.lat, ll.lng]); } }} />}
          </BaseMap>
          <div className="absolute left-5 right-5 top-5 z-[500] flex flex-wrap items-center justify-between gap-2">
            <div className="glass-strong flex items-center gap-2 px-3.5 py-2 text-sm font-semibold">
              <MapPin className="h-4 w-4 text-sky" />
              {pos ? `${safeFixed(pos[0], 5)}, ${safeFixed(pos[1], 5)}. Drag the pin to adjust.` : 'Search a place, then click the road where it happened'}
            </div>
            <ClayButton size="sm" variant="white" type="button" onClick={locate}><LocateFixed className="h-4 w-4 text-sky" /> My location</ClayButton>
          </div>
        </div>

        <form onSubmit={submit} className="glass space-y-5 p-6">
          <ErrorBanner message={error} />
          <fieldset>
            <legend className="label">What happened?</legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {TYPES.map((t) => {
                const { icon: Icon, color } = TYPE_META[t];
                const on = form.type === t;
                return (
                  <motion.button key={t} type="button" onClick={() => setForm({ ...form, type: t })}
                    whileTap={{ scale: 0.93 }} animate={{ y: on ? -3 : 0 }} transition={{ type: 'spring', stiffness: 420, damping: 18 }}
                    aria-pressed={on}
                    className={`flex flex-col items-center gap-2 rounded-3xl px-3 py-4 text-sm font-bold transition-colors ${on ? 'bg-white shadow-clay-white ring-2' : 'bg-white/45 hover:bg-white/70'}`}
                    style={on ? { '--tw-ring-color': color } : undefined}>
                    <span className="grid h-11 w-11 place-items-center rounded-2xl" style={{ background: `${color}22`, color }}><Icon className="h-6 w-6" /></span>
                    {t}
                  </motion.button>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="label">Severity</legend>
            <div className="grid grid-cols-4 gap-2">
              {SEVERITIES.map((s) => {
                const on = form.severity === s;
                return (
                  <motion.button key={s} type="button" whileTap={{ scale: 0.92 }} onClick={() => setForm({ ...form, severity: s })} aria-pressed={on}
                    className="rounded-2xl px-2 py-2.5 text-sm font-bold transition-shadow"
                    style={{ background: on ? SEV_COLOR[s] : SEV_SOFT[s], color: '#1E2A44', boxShadow: on ? `inset 0 -3px 0 rgba(0,0,0,.12), 0 10px 18px -10px ${SEV_COLOR[s]}` : 'none' }}>
                    {s}
                  </motion.button>
                );
              })}
            </div>
            {ai?.severity && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl bg-lilac-soft/80 px-4 py-2.5 text-sm">
                <BrainCircuit className="h-5 w-5 text-lilac" />
                <span>
                  The model suggests <span className="font-bold">{ai.severity}</span> ({Math.round((ai.confidence || 0) * 100)}% confidence) for this type, place and local time.
                </span>
                {form.severity !== ai.severity && (
                  <button type="button" onClick={() => setForm({ ...form, severity: ai.severity })} className="ml-auto rounded-xl bg-white px-3 py-1 text-xs font-bold text-lilac shadow-clay-white">Use suggestion</button>
                )}
              </motion.div>
            )}
            {ai?.off && <p className="mt-2 text-xs text-ink-faint">AI suggestion unavailable: {ai.off}</p>}
          </fieldset>

          <div>
            <label className="label" htmlFor="desc">Description</label>
            <textarea id="desc" rows={3} maxLength={500} className="neu-field resize-none" placeholder="e.g. Two-wheeler skid near the median, left lane blocked"
              value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <p className="mt-1 text-right text-xs text-ink-faint">{form.description.length}/500</p>
          </div>

          <div className={`grid gap-4 ${isAdmin ? 'sm:grid-cols-2' : ''}`}>
            <div>
              <label className="label" htmlFor="when">When</label>
              <input id="when" type="datetime-local" className="neu-field" max={nowLocal()} value={form.reportedAt} onChange={(e) => setForm({ ...form, reportedAt: e.target.value })} />
            </div>
            {isAdmin && (
              <div>
                <label className="label" htmlFor="status">Status</label>
                <select id="status" className="neu-field" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
            )}
          </div>

          <ClayButton type="submit" loading={busy} className="w-full" variant="sun">Submit report</ClayButton>
          {!isAdmin && <p className="text-center text-xs text-ink-faint">Your report stays pending until an administrator verifies it.</p>}
        </form>
      </div>
    </>
  );
}

export default function ReportIncident() {
  const [mode, setMode] = useState('single');
  return (
    <div>
      <PageHeader
        title="Report an incident"
        subtitle={mode === 'single' ? 'Mark the exact spot on the road, then describe what happened.' : 'Import incidents in bulk from a file. Every map and chart updates when the import finishes.'}
        actions={<Segmented value={mode} onChange={setMode} options={[{ value: 'single', label: 'Single report' }, { value: 'upload', label: 'Upload dataset' }]} />}
      />
      {mode === 'single' ? <SingleReport /> : (<><UploadWizard /><DatasetsPanel /></>)}
    </div>
  );
}
