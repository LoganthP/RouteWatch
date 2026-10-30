// RouteWatch — robust resumable dataset uploader (frontend).
// Why the old one failed ("missing chunks [0,1,2…]"): when one chunk got a 404 it called
// /upload/init again, got a NEW empty session, but kept its local "already sent" list from
// the OLD session — so it only sent the remaining chunks and /complete correctly refused.
// Rules here: the SERVER is the source of truth for which chunks exist; every retry asks it.
//
// Usage:
//   const { dataset, entries } = await uploadDataset(file, {
//     baseUrl: '/api/datasets', getHeaders: () => ({ Authorization: `Bearer ${token}` }),
//     onProgress: ({ percent, loaded, total, speedBps, etaSec, phase }) => …,
//     signal: abortController.signal,
//   });

const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Upload cancelled', 'AbortError')); }, { once: true });
});

class UploadError extends Error {
  constructor(message, { status, code, missing } = {}) { super(message); this.status = status; this.code = code; this.missing = missing; }
}

async function api(url, { method = 'GET', body, headers = {}, signal } = {}) {
  const res = await fetch(url, {
    method, signal,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new UploadError(data.error || `Request failed (${res.status})`, { status: res.status, code: data.code, missing: data.missing });
  return data;
}

/** PUT one chunk with XHR (fetch has no upload progress). */
function putChunk(url, blob, headers, signal, onBytes) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let last = 0;
    xhr.open('PUT', url);
    xhr.timeout = 10 * 60 * 1000;
    Object.entries(headers || {}).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => { onBytes(e.loaded - last); last = e.loaded; };
    xhr.onload = () => {
      let data = {}; try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* ignore */ }
      onBytes(-last); last = 0;
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else { reject(new UploadError(data.error || `Chunk failed (${xhr.status})`, { status: xhr.status, code: data.code })); }
    };
    xhr.onerror = () => { onBytes(-last); reject(new UploadError('Network error', { status: 0 })); };
    xhr.ontimeout = () => { onBytes(-last); reject(new UploadError('Chunk timed out', { status: 0 })); };
    signal?.addEventListener('abort', () => { xhr.abort(); onBytes(-last); reject(new DOMException('Upload cancelled', 'AbortError')); }, { once: true });
    xhr.send(blob);
  });
}

export async function uploadDataset(file, {
  baseUrl = '/api/datasets', getHeaders = () => ({}), onProgress = () => {}, signal, concurrency = 3, name,
} = {}) {
  const total = file.size;
  const fingerprint = `${file.name}:${file.size}:${file.lastModified}`;
  const started = Date.now();
  let confirmed = 0; let inflight = 0;
  const report = (phase) => {
    const loaded = Math.min(total, confirmed + inflight);
    const secs = (Date.now() - started) / 1000;
    const speedBps = secs > 0 ? loaded / secs : 0;
    onProgress({ phase, loaded, total, percent: Math.round((loaded / total) * 1000) / 10, speedBps, etaSec: speedBps ? Math.round((total - loaded) / speedBps) : null });
  };

  for (let sessionAttempt = 0; sessionAttempt < 3; sessionAttempt++) {
    // 1) start or RESUME (same fingerprint => same server session, with its received list)
    const session = await api(`${baseUrl}/upload/init`, {
      method: 'POST', headers: getHeaders(), signal,
      body: { fileName: file.name, size: total, mimeType: file.type, fingerprint },
    });
    const { uploadId, chunkSize, totalChunks } = session;
    const sizeOf = (i) => Math.min(chunkSize, total - i * chunkSize);
    try {
      for (let round = 0; round < 4; round++) {
        // 2) ask the server what it still needs — never trust local bookkeeping
        const status = await api(`${baseUrl}/upload/${uploadId}`, { headers: getHeaders(), signal });
        confirmed = status.received.reduce((a, i) => a + sizeOf(i), 0);
        report('uploading');
        const todo = [...status.missing];
        if (!todo.length) break;

        const worker = async () => {
          while (todo.length) {
            const index = todo.shift();
            const blob = file.slice(index * chunkSize, index * chunkSize + sizeOf(index));
            for (let attempt = 0; ; attempt++) {
              try {
                await putChunk(`${baseUrl}/upload/${uploadId}/chunk?index=${index}`, blob, getHeaders(), signal,
                  (d) => { inflight += d; report('uploading'); });
                confirmed += blob.size; report('uploading');
                break;
              } catch (err) {
                if (err.name === 'AbortError' || err.code === 'SESSION_GONE' || err.status === 404) throw err;
                if (err.status && err.status < 500 && err.status !== 408 && err.status !== 429) throw err;
                if (attempt >= 5) throw err;
                await sleep(Math.min(15000, 500 * 2 ** attempt) + Math.random() * 300, signal); // backoff
              }
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
      }

      // 3) assemble + server-side inspection (can take a few seconds for big archives)
      report('processing');
      for (let i = 0; i < 3; i++) {
        try {
          const done = await api(`${baseUrl}/upload/${uploadId}/complete`, { method: 'POST', headers: getHeaders(), signal, body: { name: name || file.name } });
          onProgress({ phase: 'done', loaded: total, total, percent: 100, speedBps: 0, etaSec: 0 });
          return done; // { dataset, entries }
        } catch (err) {
          if (err.code !== 'MISSING_CHUNKS') throw err;
          for (const index of err.missing) { // re-send exactly what the server says is missing
            const blob = file.slice(index * chunkSize, index * chunkSize + sizeOf(index));
            await putChunk(`${baseUrl}/upload/${uploadId}/chunk?index=${index}`, blob, getHeaders(), signal, () => {});
          }
        }
      }
      throw new UploadError('Upload could not be completed after retries');
    } catch (err) {
      if (err.name === 'AbortError') {
        api(`${baseUrl}/upload/${uploadId}`, { method: 'DELETE', headers: getHeaders() }).catch(() => {});
        throw err;
      }
      if (err.code === 'SESSION_GONE' || err.status === 404) { confirmed = 0; inflight = 0; continue; } // start a clean session
      throw err;
    }
  }
  throw new UploadError('Upload session kept expiring — please try again');
}

/* ---------------- import + insights helpers ---------------- */

/** selections: [{ entryId, mapping }] — omit to import all files with the auto-detected mapping. */
export const startImport = (datasetId, selections, { baseUrl = '/api/datasets', getHeaders = () => ({}) } = {}) =>
  api(`${baseUrl}/${datasetId}/import`, { method: 'POST', headers: getHeaders(), body: { selections } });

export const cancelImport = (datasetId, { baseUrl = '/api/datasets', getHeaders = () => ({}) } = {}) =>
  api(`${baseUrl}/${datasetId}/cancel`, { method: 'POST', headers: getHeaders() });

export const getInsights = (datasetId, { baseUrl = '/api/datasets', getHeaders = () => ({}) } = {}) =>
  api(`${baseUrl}/${datasetId}/insights`, { headers: getHeaders() });

/**
 * Live progress via your existing socket.io client; falls back to polling if the socket drops.
 * Returns an unsubscribe function. cb receives { status, percent, stored, invalid, rowsPerSec, etaSec, file }.
 */
export function watchImport(socket, datasetId, cb, { baseUrl = '/api/datasets', getHeaders = () => ({}) } = {}) {
  let stopped = false;
  const onMsg = (p) => { if (p.datasetId === datasetId) cb(p); };
  socket?.on('dataset:progress', onMsg);
  const poll = async () => {
    while (!stopped) {
      await new Promise((r) => setTimeout(r, socket?.connected ? 5000 : 1500));
      try {
        const d = await api(`${baseUrl}/${datasetId}/insights`, { headers: getHeaders() });
        if (stopped) return;
        cb({ datasetId, status: d.status, ...(d.progress || {}) });
        if (['ready', 'failed', 'cancelled', 'interrupted'].includes(d.status)) return;
      } catch { /* keep polling */ }
    }
  };
  poll();
  return () => { stopped = true; socket?.off('dataset:progress', onMsg); };
}

export const formatBytes = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(2)} GB`);
