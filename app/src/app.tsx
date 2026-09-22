import { useEffect } from 'react';
import type { PropsWithChildren } from 'react';
import { bootstrap } from './store';
import './app.css';

export default function App({ children }: PropsWithChildren) {
  useEffect(() => {
    bootstrap();
  }, []);
  return children as JSX.Element;
}
