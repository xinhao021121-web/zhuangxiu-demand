import { useEffect } from 'react';
import type { PropsWithChildren } from 'react';
import { bootstrap } from './store';
import { isH5 } from './platform/env';
import { trackSession, watchInstall } from './platform/telemetry';
import './app.css';

/** 手机版：装到主屏幕之后断网也能打开。只有 H5 需要——小程序端本身就带离线外壳。 */
function registerServiceWorker() {
  if (!isH5 || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // 装不上不影响填写：草稿本来就存在本机
  });
}

export default function App({ children }: PropsWithChildren) {
  useEffect(() => {
    // 先读回草稿再记会话：会话事件并进草稿之后才不会被读回动作覆盖
    bootstrap();
    registerServiceWorker();
    trackSession();
    return watchInstall();
  }, []);
  return children as JSX.Element;
}
