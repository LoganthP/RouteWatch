import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import './index.css';

// Last-resort safety net: show a toast instead of failing silently.
const toast = (message) => window.dispatchEvent(new CustomEvent('rw:toast', { detail: { message, kind: 'error' } }));
window.addEventListener('error', (e) => { if (e?.message && !/ResizeObserver/.test(e.message)) toast(`Unexpected error: ${e.message}`); });
window.addEventListener('unhandledrejection', (e) => {
  const m = e?.reason?.response?.data?.message || e?.reason?.message;
  if (m && !/aborted|canceled/i.test(m)) toast(m);
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </MotionConfig>
  </React.StrictMode>
);
