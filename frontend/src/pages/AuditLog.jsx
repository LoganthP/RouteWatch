import { ScrollText } from 'lucide-react';
import useApi, { useLiveRefresh } from '../lib/useApi';
import { EmptyState, ErrorBanner, Glass, PageHeader, Spinner } from '../components/ui';
import { fmtDate } from '../lib/format';

const TONE = { CREATE: '#2E9BFF', UPDATE: '#9B8CFF', STATUS: '#13A87C', DELETE: '#FF4D6D', SEED: '#E8A800', IMPORT: '#2BD9A6', DELETE_DATASET: '#FF4D6D', TRAIN_MODEL: '#9B8CFF' };

function describe(h) {
  if (h.action === 'STATUS') return `changed status from ${h.changes?.status?.from} to ${h.changes?.status?.to}`;
  if (h.action === 'CREATE') return `reported a ${h.changes?.severity?.toLowerCase()} ${h.changes?.type?.toLowerCase()}`;
  if (h.action === 'UPDATE') return `edited ${Object.keys(h.changes || {}).join(', ') || 'no fields'}`;
  if (h.action === 'DELETE') return 'deleted the incident';
  if (h.action === 'SEED') return `loaded ${Number(h.changes?.inserted || 0).toLocaleString('en-IN')} synthetic incidents`;
  if (h.action === 'IMPORT') return `imported dataset "${h.changes?.dataset}" (${h.changes?.status}: ${Number(h.changes?.imported || 0).toLocaleString('en-IN')} rows, ${Number(h.changes?.skipped || 0).toLocaleString('en-IN')} rejected)`;
  if (h.action === 'DELETE_DATASET') return `deleted dataset "${h.changes?.dataset}" and ${Number(h.changes?.deleted || 0).toLocaleString('en-IN')} incidents`;
  if (h.action === 'TRAIN_MODEL') return `trained severity model v${h.changes?.version} (accuracy ${Math.round((h.changes?.accuracy || 0) * 100)}%)`;
  return String(h.action || '').toLowerCase();
}

export default function AuditLog() {
  const { data, loading, error, reload } = useApi('/audit', { limit: 200 });
  useLiveRefresh(reload);
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Every verification and administrative change, newest first." />
      <ErrorBanner message={error} onRetry={reload} />
      <Glass className="p-5 sm:p-7">
        {loading && !data ? <Spinner /> : Array.isArray(data) && data.length ? (
          <ol className="relative space-y-4 border-l-4 border-dashed border-sun pl-6">
            {(Array.isArray(data) ? data : []).map((h) => (
              <li key={h._id} className="relative">
                <span className="absolute -left-[2.15rem] top-1.5 h-4 w-4 rotate-45 rounded-[4px] border-2 border-white" style={{ background: TONE[h.action] || '#5B6B8C' }} />
                <p className="text-[15px]">
                  <span className="font-bold">{h.actorName}</span> {describe(h)}
                  {h.incidentId && <> on <span className="font-bold text-sky-deep">{h.incidentId}</span></>}
                </p>
                {h.note && <p className="text-sm text-ink-soft">{h.note}</p>}
                <p className="text-xs text-ink-faint">{fmtDate(h.createdAt)}</p>
              </li>
            ))}
          </ol>
        ) : <EmptyState icon={ScrollText} title="No changes recorded yet">Verify, resolve or edit an incident and it will appear here.</EmptyState>}
      </Glass>
    </div>
  );
}
