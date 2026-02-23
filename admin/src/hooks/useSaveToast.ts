import { useState, useCallback, useRef } from 'react';

/**
 * Hook for showing a temporary save-success toast that auto-dismisses after 3 seconds.
 */
export function useSaveToast() {
  const [saveSuccess, setSaveSuccess] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showSaveToast = useCallback(() => {
    setSaveSuccess(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSaveSuccess(false), 3000);
  }, []);

  return { saveSuccess, showSaveToast };
}
