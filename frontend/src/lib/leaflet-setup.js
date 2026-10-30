// Leaflet's ESM build doesn't expose a global; leaflet.heat expects window.L.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

if (typeof window !== 'undefined') window.L = L;
export default L;
