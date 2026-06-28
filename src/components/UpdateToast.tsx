import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, X } from 'lucide-react';

/** Small toast shown when an in-place update is downloaded and ready to install. */
export default function UpdateToast() {
  const [info, setInfo] = useState<any>(null);

  useEffect(() => {
    const off = window.dawn.updater.onStatus(({ status, info }: any) => {
      if (status === 'ready') setInfo(info || {});
      if (status === 'none' || status === 'error') setInfo((cur: any) => cur); // keep an existing ready toast
    });
    return off;
  }, []);

  return (
    <AnimatePresence>
      {info ? (
        <motion.div
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          className="fixed bottom-4 right-4 z-[2000] glass p-4 w-80"
        >
          <div className="flex items-start gap-2">
            <RefreshCw size={16} className="text-neural-cyan mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-semibold">Update ready{info.version ? ` (v${info.version})` : ''}</div>
              <div className="text-xs text-dim mt-0.5">DAWN will update in place — your chats, memory and models are preserved.</div>
              <div className="flex gap-2 mt-2">
                <button onClick={() => window.dawn.updater.install()} className="text-xs px-3 py-1.5 rounded-lg bg-neural-cyan/20 border border-neural-cyan/60 text-neural-cyan">Restart &amp; update</button>
                <button onClick={() => setInfo(null)} className="text-xs px-3 py-1.5 rounded-lg border border-border text-dim">Later</button>
              </div>
            </div>
            <button onClick={() => setInfo(null)} className="text-faint hover:text-ink"><X size={14} /></button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
