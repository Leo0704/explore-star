import { useEffect, useRef } from 'react';

/**
 * 每隔 intervalMs 毫秒执行一次 fn，组件挂载时立即执行一次，卸载时清理定时器。
 * callback 通过 ref 持有，引用变化不会重启定时器。
 */
export function usePolling(fn: () => void, intervalMs: number): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    fnRef.current();
    const id = setInterval(() => fnRef.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
