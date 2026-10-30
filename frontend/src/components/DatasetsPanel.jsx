import { useNavigate } from 'react-router-dom';
import { Database, Map as MapIcon, ChartColumnBig, FileDown, Trash2 } from 'lucide-react';
import useApi, { useLiveRefresh } from '../lib/useApi';
import api, { download, errMsg } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { EmptyState, ErrorBanner, Spinner } from './ui';
import { fmtBytes, fmtDate, fmtNum } from '../lib/format';
import { safeArr } from '../lib/safe';

const TONE = {
  completed: ['#D7F8EE', '#0E8A65'], importing: ['#DCEEFF', '#1677E0'], uploaded: ['#ECE8FF', '#5B47E0'],
  failed: ['#FFE1E7', '#D23A57'], cancelled: ['#EEF1F6', '#5B6B8C'], stopped: ['#FFF3CC', '#9A6B00'], deleting: ['#FFE1E7', '#D23A57'],
};

export default function DatasetsPanel() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi('/datasets');
  useLiveRefresh(reload);

  const remove = async (d) => {
    if (!window.confirm(`Delete "${d.name}" and its ${fmtNum(d.progress?.imported)} incidents? This cannot be undone.`)) return;
    try { await api.delete(`/datasets/${d._id}`); toast(`Deleting "${d.name}"…`, 'info'); reload(); } catch (e) { toast(errMsg(e), 'error'); }
  };

  return (
    <div className="glass mt-5 p-5 sm:p-7">
      <h2 className="mb-4 text-xl font-bold">Imported datasets</h2>
      <ErrorBanner message={error} onRetry={reload} />
      {loading && !data ? <Spinner /> : !safeArr(data).length ? (
        <EmptyState icon={Database} title="No datasets yet">Upload a file above and its incidents will appear on every map and chart.</EmptyState>
      ) : (
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead><tr className="text-ink-soft">{['Dataset', 'Status', 'Imported', 'Rejected', 'Uploaded by', ''].map((h) => <th key={h} scope="col" className="px-3 py-2 font-bold">{h}</th>)}</tr></thead>
            <tbody>
              {safeArr(data).map((d) => {
                const [bg, fg] = TONE[d.status] || TONE.cancelled;
                const usable = (d.progress?.imported || 0) > 0 && !['deleting', 'importing'].includes(d.status);
                return (
                  <tr key={d._id} className="border-t border-white/70 align-top">
                    <td className="px-3 py-3">
                      <p className="font-bold">{d.name}</p>
                      <p className="text-xs text-ink-soft">{d.file?.name}, {fmtBytes(d.file?.size)}</p>
                      {d.statusNote && <p className="mt-1 max-w-sm text-xs text-ink-faint">{d.statusNote}</p>}
                    </td>
                    <td className="px-3 py-3"><span className="rounded-full px-2.5 py-1 text-xs font-bold capitalize" style={{ background: bg, color: fg }}>{d.status}</span></td>
                    <td className="px-3 py-3 font-semibold">{fmtNum(d.progress?.imported)}</td>
                    <td className="px-3 py-3">{fmtNum(d.rejectedCount ?? d.progress?.skipped)}</td>
                    <td className="px-3 py-3"><p>{d.createdByName || '—'}</p><p className="text-xs text-ink-faint">{fmtDate(d.createdAt)}</p></td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-1.5">
                        {usable && <IconBtn label="View on map" onClick={() => navigate(`/map?dataset=${d._id}`)}><MapIcon className="h-4 w-4 text-sky" /></IconBtn>}
                        {usable && <IconBtn label="Analyze" onClick={() => navigate(`/analytics?dataset=${d._id}`)}><ChartColumnBig className="h-4 w-4 text-sun-deep" /></IconBtn>}
                        {(d.rejectedCount || 0) > 0 && <IconBtn label="Download rejected rows" onClick={() => download(`/datasets/${d._id}/rejected.csv`, {}, 'rejected.csv').catch((e) => toast(errMsg(e), 'error'))}><FileDown className="h-4 w-4 text-coral" /></IconBtn>}
                        {isAdmin && !['deleting', 'importing'].includes(d.status) && <IconBtn label="Delete dataset" onClick={() => remove(d)}><Trash2 className="h-4 w-4 text-coral" /></IconBtn>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function IconBtn({ label, children, ...rest }) {
  return <button type="button" title={label} aria-label={label} className="grid h-9 w-9 place-items-center rounded-xl bg-white shadow-clay-white hover:bg-sky-soft" {...rest}>{children}</button>;
}
