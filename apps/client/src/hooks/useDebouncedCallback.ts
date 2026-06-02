import { useRef, useCallback, useEffect } from "react";

export function useDebouncedCallback<T extends (...args: any[]) => void>(
  fn: T,
  delay: number = 500
): T {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  const debounced = useCallback(
    (...args: any[]) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        fnRef.current(...args);
        timerRef.current = null;
      }, delay);
    },
    [delay]
  ) as unknown as T;

  return debounced;
}
