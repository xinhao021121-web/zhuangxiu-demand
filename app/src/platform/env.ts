import { useEffect, useState } from 'react';

export const isH5 = process.env.TARO_ENV === 'h5';

/** 宽屏断点：宽屏是 Web，窄屏是小程序与展示版（见技术方案 3.2）。 */
export const WIDE_BREAKPOINT = 1024;

function query(): boolean {
  if (!isH5 || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(`(min-width: ${WIDE_BREAKPOINT}px)`).matches;
}

/** 端形态判断只允许出现在壳组件里，字段控件本身不判断平台。 */
export function useIsWide(): boolean {
  const [wide, setWide] = useState(query);
  useEffect(() => {
    if (!isH5 || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(`(min-width: ${WIDE_BREAKPOINT}px)`);
    const onChange = () => setWide(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return wide;
}
