import { CarFront, TrafficCone, Construction, Ban, TriangleAlert, CircleHelp } from 'lucide-react';

export const MYSURU = [12.3052, 76.6552]; // [lat, lng] fallback only
export const WORLD_VIEW = { center: [20, 10], zoom: 2 };
// OpenStreetMap standard tiles: free, no API key (fine for academic/demo use)
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export const TYPES = ['Accident', 'Congestion', 'Construction', 'Road Closure', 'Hazard', 'Other'];
export const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];
export const STATUSES = ['Pending', 'Verified', 'Resolved', 'Rejected'];

export const SEV_COLOR = { Low: '#2BD9A6', Medium: '#FFC93C', High: '#FF8A3D', Critical: '#FF4D6D' };
export const SEV_SOFT = { Low: '#D7F8EE', Medium: '#FFF3CC', High: '#FFE8D6', Critical: '#FFE1E7' };
export const STATUS_STYLE = {
  Pending: { bg: '#ECE8FF', fg: '#5B47E0' },
  Verified: { bg: '#DCEEFF', fg: '#1677E0' },
  Resolved: { bg: '#D7F8EE', fg: '#0E8A65' },
  Rejected: { bg: '#EEF1F6', fg: '#5B6B8C' },
};

export const TYPE_META = {
  Accident: { icon: CarFront, color: '#FF4D6D' },
  Congestion: { icon: TrafficCone, color: '#FF8A3D' },
  Construction: { icon: Construction, color: '#E8A800' },
  'Road Closure': { icon: Ban, color: '#9B8CFF' },
  Hazard: { icon: TriangleAlert, color: '#2E9BFF' },
  Other: { icon: CircleHelp, color: '#5B6B8C' },
};

export const emptyFilters = (init = {}) => ({ type: [], severity: [], status: [], area: '', dataset: '', from: '', to: '', search: '', ...init });

/** Filter object → query params (arrays become comma lists, blanks dropped) */
export function toParams(f = {}) {
  const p = {};
  Object.entries(f).forEach(([k, v]) => {
    if (Array.isArray(v)) { if (v.length) p[k] = v.join(','); }
    else if (v !== '' && v !== null && v !== undefined) p[k] = v;
  });
  return p;
}
