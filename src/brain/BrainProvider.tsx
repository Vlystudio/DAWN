import { useEffect } from 'react';
import { useBrainStore } from '../state/brainStore';
import { useRuntimeStore } from '../state/runtimeStore';
import { statusToBrain, runtimeToBrain } from './BrainState';

/**
 * BrainProvider — wires REAL chat events to the brain state machine so the
 * brain is never fake. Mounted once at the app root.
 *
 *   chat:status  -> RETRIEVING_MEMORY / SEARCHING_WEB / READING_LOCAL_FILES / THINKING
 *   chat:token   -> RESPONDING
 *   chat:done    -> IDLE
 *   chat:error   -> ERROR (briefly), then IDLE
 */
export default function BrainProvider() {
  const setBrain = useBrainStore((s) => s.setBrain);
  const setRuntime = useRuntimeStore((s) => s.setStatus);

  // Runtime events drive the base brain state (boot/ready/error) without
  // stomping an active chat state (thinking/responding).
  useEffect(() => {
    useRuntimeStore.getState().refresh();
    const off = window.dawn.runtime.onUpdate((status: any) => {
      setRuntime(status);
      const cur = useBrainStore.getState().state;
      if (['OFF', 'STARTING', 'LOADING_MODEL', 'STOPPING', 'ERROR'].includes(status.state)) {
        setBrain(runtimeToBrain(status.state), status.error || status.detail || undefined);
      } else if (status.state === 'READY' && ['OFF', 'BOOTING', 'ERROR'].includes(cur)) {
        setBrain('IDLE', 'Local AI ready.');
      }
    });
    return off;
  }, [setBrain, setRuntime]);

  useEffect(() => {
    let errT: any;
    const offStatus = window.dawn.chat.onStatus(({ status, brain }: any) => setBrain(brain || statusToBrain(status), status));
    const offTok = window.dawn.chat.onToken(() => {
      if (useBrainStore.getState().state !== 'RESPONDING') setBrain('RESPONDING', 'Composing the answer…');
    });
    const offDone = window.dawn.chat.onDone(() => setBrain('IDLE', 'Listening for you.'));
    const offErr = window.dawn.chat.onError(({ error }: any) => {
      setBrain('ERROR', error);
      clearTimeout(errT);
      errT = setTimeout(() => setBrain('IDLE', 'Listening for you.'), 4500);
    });
    return () => {
      offStatus();
      offTok();
      offDone();
      offErr();
      clearTimeout(errT);
    };
  }, [setBrain]);

  return null;
}
