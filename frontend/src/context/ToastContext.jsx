import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Info, XCircle } from 'lucide-react';

const ToastCtx = createContext(() => {});
const ICON = { success: CheckCircle2, error: XCircle, info: Info };
const TONE = { success: 'text-mint-deep', error: 'text-coral', info: 'text-sky' };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, kind = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  // global error hooks (main.jsx) and other non-React code post toasts through this event
  useEffect(() => {
    const h = (e) => push(e.detail?.message || 'Something went wrong.', e.detail?.kind || 'error');
    window.addEventListener('rw:toast', h);
    return () => window.removeEventListener('rw:toast', h);
  }, [push]);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[2000] flex w-[min(92vw,380px)] flex-col gap-3" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => {
            const Icon = ICON[t.kind];
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 24, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 60 }}
                transition={{ type: 'spring', stiffness: 380, damping: 26 }}
                className="glass-strong pointer-events-auto flex items-start gap-3 px-4 py-3.5"
              >
                <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${TONE[t.kind]}`} />
                <p className="text-sm font-semibold text-ink">{t.message}</p>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
