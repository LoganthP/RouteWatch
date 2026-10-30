import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDownUp, CheckCheck, ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, ShieldCheck, Trash2, X, XCircle, ListChecks } from 'lucide-react';
import { Marker } from 'react-leaflet';
import useApi, { useLiveRefresh } from '../lib/useApi';
import api, { download, errMsg } from '../api/client';
import FilterBar from '../components/FilterBar';
import { BaseMap, pickIcon } from '../components/MapParts';
import { ClayButton, EmptyState, ErrorBanner, PageHeader, SeverityPill, Spinner, StatusPill, TypeBadge } from '../components/ui';
import { emptyFilters, toParams } from '../lib/constants';
import { fmtDate, fmtNum } from '../lib/format';
import { safeArr, toLatLng } from '../lib/safe';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const COLS = [
  { key: 'incidentId', label: 'Incident' },
  { key: 'type', label: 'Type', sort: true },
  { key: 'severity', label: 'Severity', sort: true },
  { key: 'status', label: 'Status', sort: true },
  { key: 'area', label: 'Area', sort: true },
  { key: 'reportedAt', label: 'Reported', sort: true },
];

function Detail({ incident, onClose, onChanged }) {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const history = useApi('/audit', { incidentId: incident.incidentId, limit: 20 }, { skip: !isAdmin });

  const act = async (label, fn, success) => {
    setBusy(label); setError('');
    try { await fn(); toast(success); onChanged(); history.reload(); }
    catch (e) { setError(errMsg(e)); }
    finally { setBusy(''); }
  };
  const setStatus = (status, success) =>
    act(status, () => api.patch(`/incidents/${incident.incidentId}/status`, { status }), success);
  const remove = () => {
    if (!window.confirm(`Delete ${incident.incidentId}? This cannot be undone.`)) return;
    act('delete', () => api.delete(`/incidents/${incident.incidentId}`), `${incident.incidentId} deleted`).then(onClose);
  };
  const pos = toLatLng(incident.location?.coordinates);

  return (
    <>
      <motion.div className="fixed inset-0 z-[1400] bg-ink/20 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.aside role="dialog" aria-label={`Incident ${incident.incidentId}`}
        className="fixed bottom-3 right-3 top-3 z-[1500] w-[min(94vw,28rem)]"
        initial={{ x: '110%' }} animate={{ x: 0 }} exit={{ x: '110%' }} transition={{ type: 'spring', stiffness: 300, damping: 32 }}>
        <div className="glass-strong scroll-thin flex h-full flex-col gap-5 overflow-y-auto p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <TypeBadge value={incident.type} />
              <div>
                <h2 className="text-2xl font-extrabold">{incident.type}</h2>
                <p className="text-sm font-semibold text-ink-soft">{incident.incidentId}</p>
              </div>
            </div>
            <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl hover:bg-white" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>
          <div className="flex gap-2"><SeverityPill value={incident.severity} /><StatusPill value={incident.status} /></div>
          {pos && (
            <div className="overflow-hidden rounded-2xl shadow-clay-white">
              <BaseMap center={pos} zoom={16} className="h-48 w-full" zoomControl={false} dragging={false} scrollWheelZoom={false}>
                <Marker position={pos} icon={pickIcon} />
              </BaseMap>
            </div>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            {[
              ['Area', incident.area],
              ['Source', incident.source],
              ['Reported', fmtDate(incident.reportedAt)],
              ['Resolved', fmtDate(incident.resolvedAt)],
              ['Longitude', incident.location?.coordinates?.[0] ?? '—'],
              ['Latitude', incident.location?.coordinates?.[1] ?? '—'],
              ['Time zone', incident.tz || 'UTC'],
              ...(incident.aiSeverity ? [['AI suggested', incident.aiSeverity]] : []),
            ].map(([k, v]) => (
              <div key={k}><dt className="font-semibold text-ink-soft">{k}</dt><dd className="font-bold">{v}</dd></div>
            ))}
          </dl>
          {incident.description && <p className="rounded-2xl bg-white/70 p-4 text-[15px]">{incident.description}</p>}
          <ErrorBanner message={error} />

          {isAdmin && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <ClayButton size="sm" loading={busy === 'Verified'} disabled={incident.status === 'Verified'} onClick={() => setStatus('Verified', `${incident.incidentId} verified`)}>
                  <ShieldCheck className="h-4 w-4" /> Verify
                </ClayButton>
                <ClayButton size="sm" variant="sun" loading={busy === 'Resolved'} disabled={incident.status === 'Resolved'} onClick={() => setStatus('Resolved', `${incident.incidentId} resolved`)}>
                  <CheckCheck className="h-4 w-4" /> Resolve
                </ClayButton>
                <ClayButton size="sm" variant="white" loading={busy === 'Rejected'} disabled={incident.status === 'Rejected'} onClick={() => setStatus('Rejected', `${incident.incidentId} rejected`)}>
                  <XCircle className="h-4 w-4 text-ink-soft" /> Reject
                </ClayButton>
                <ClayButton size="sm" variant="white" loading={busy === 'delete'} onClick={remove} className="!text-coral">
                  <Trash2 className="h-4 w-4" /> Delete
                </ClayButton>
              </div>
              <div>
                <h3 className="mb-2 font-bold">History</h3>
                {safeArr(history.data).length ? (
                  <ol className="space-y-2 border-l-4 border-dashed border-sun pl-4">
                    {safeArr(history.data).map((h) => (
                      <li key={h._id} className="text-sm">
                        <span className="font-bold">{h.action.toLowerCase()}</span> by {h.actorName}
                        {h.changes?.status && <> ({h.changes.status.from} to {h.changes.status.to})</>}
                        <p className="text-xs text-ink-faint">{fmtDate(h.createdAt)}</p>
                      </li>
                    ))}
                  </ol>
                ) : <p className="text-sm text-ink-faint">No changes recorded since import.</p>}
              </div>
            </>
          )}
        </div>
      </motion.aside>
    </>
  );
}

export default function Incidents() {
  const [sp] = useSearchParams();
  const [filters, setFilters] = useState(() => emptyFilters({ dataset: sp.get('dataset') || '' }));
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ key: 'reportedAt', dir: 'desc' });
  const [selected, setSelected] = useState(null);
  const [exporting, setExporting] = useState('');
  const toast = useToast();

  // debounce text search
  useEffect(() => {
    const t = setTimeout(() => setSearch(filters.search), 350);
    return () => clearTimeout(t);
  }, [filters.search]);
  useEffect(() => setPage(1), [search, filters.type, filters.severity, filters.status, filters.area, filters.dataset, filters.from, filters.to]);

  const params = { ...toParams({ ...filters, search }), page, limit: 15, sort: sort.key, dir: sort.dir };
  const { data, loading, error, reload } = useApi('/incidents', params);
  useLiveRefresh(reload);

  const exportFile = async (kind) => {
    setExporting(kind);
    try { await download(`/reports/${kind}`, toParams({ ...filters, search }), `routewatch.${kind}`); toast(`${kind.toUpperCase()} downloaded`); }
    catch (e) { toast(errMsg(e), 'error'); }
    finally { setExporting(''); }
  };

  const toggleSort = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));

  return (
    <div>
      <PageHeader
        title="Incidents"
        subtitle="Search, review and manage every report. Exports use the filters you apply here."
        actions={
          <>
            <ClayButton size="sm" variant="white" loading={exporting === 'csv'} onClick={() => exportFile('csv')}><FileSpreadsheet className="h-4 w-4 text-mint-deep" /> Export CSV</ClayButton>
            <ClayButton size="sm" variant="white" loading={exporting === 'pdf'} onClick={() => exportFile('pdf')}><FileDown className="h-4 w-4 text-coral" /> Export PDF</ClayButton>
          </>
        }
      />
      <div className="glass mb-5 p-5"><FilterBar value={filters} onChange={setFilters} showSearch /></div>
      <ErrorBanner message={error} onRetry={reload} />

      <div className="glass overflow-hidden">
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/80 bg-white/40">
                {COLS.map((c) => (
                  <th key={c.key} scope="col" className="px-5 py-3.5 font-bold text-ink-soft">
                    {c.sort ? (
                      <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => toggleSort(c.key)}>
                        {c.label}<ArrowDownUp className={`h-3.5 w-3.5 ${sort.key === c.key ? 'text-sky' : 'opacity-40'}`} />
                      </button>
                    ) : c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {safeArr(data?.items).map((d) => (
                <tr key={d._id} onClick={() => setSelected(d)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSelected(d)}
                  className="cursor-pointer border-b border-white/60 transition-colors last:border-0 hover:bg-white/60">
                  <td className="px-5 py-3"><p className="font-bold">{d.incidentId}</p><p className="max-w-[16rem] truncate text-xs text-ink-soft">{d.description}</p></td>
                  <td className="px-5 py-3"><span className="inline-flex items-center gap-2 font-semibold"><TypeBadge value={d.type} size="sm" />{d.type}</span></td>
                  <td className="px-5 py-3"><SeverityPill value={d.severity} /></td>
                  <td className="px-5 py-3"><StatusPill value={d.status} /></td>
                  <td className="px-5 py-3 font-semibold">{d.area}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-ink-soft">{fmtDate(d.reportedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading && !data && <Spinner />}
        {data && !safeArr(data.items).length && <EmptyState icon={ListChecks} title="No incidents match these filters">Clear a filter or widen the date range.</EmptyState>}
        {data && data.pages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/80 px-5 py-3.5 text-sm">
            <span className="font-semibold text-ink-soft">{fmtNum(data.total)} incidents, page {data.page} of {fmtNum(data.pages)}</span>
            <div className="flex gap-2">
              <ClayButton size="sm" variant="white" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></ClayButton>
              <ClayButton size="sm" variant="white" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></ClayButton>
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {selected && (
          <Detail
            key={selected.incidentId}
            incident={selected}
            onClose={() => setSelected(null)}
            onChanged={async () => {
              reload();
              try { setSelected((await api.get(`/incidents/${selected.incidentId}`)).data); } catch { setSelected(null); }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
