import axios from 'axios';

const api = axios.create({ baseURL: `${import.meta.env.VITE_API_URL || ''}/api` });

api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('rw_token');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && !err.config.url.includes('/auth/')) {
      localStorage.removeItem('rw_token');
      window.dispatchEvent(new Event('rw:logout'));
    }
    return Promise.reject(err);
  }
);

/**
 * Honest error text: the server's own message whenever the server answered;
 * "not reachable" only when there was truly no response.
 */
export function errMsg(e) {
  if (e?.response) {
    const d = e.response.data;
    if (d && typeof d === 'object' && d.message) return d.message;
    if (typeof d === 'string' && d.trim() && d.length < 300) return d;
    return `The server answered with an error (${e.response.status}).`;
  }
  if (e?.code === 'ERR_CANCELED') return 'Cancelled.';
  if (e?.code === 'ERR_NETWORK' || e?.message === 'Network Error') return 'The API is not reachable. Start the backend (npm run dev in backend) on port 5000.';
  if (e?.code === 'ECONNABORTED') return 'The request timed out. Try again.';
  return e?.message || 'Something went wrong.';
}

/** Downloads a file response (CSV/PDF) using the auth header */
export async function download(path, params, fallbackName) {
  let res;
  try {
    res = await api.get(path, { params, responseType: 'blob' });
  } catch (e) {
    // error bodies come back as Blob when responseType is blob
    if (e?.response?.data instanceof Blob) {
      try { e.response.data = JSON.parse(await e.response.data.text()); } catch { /* keep blob */ }
    }
    throw e;
  }
  const cd = res.headers['content-disposition'] || '';
  const name = /filename="?([^"]+)"?/.exec(cd)?.[1] || fallbackName;
  const url = URL.createObjectURL(res.data);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default api;
