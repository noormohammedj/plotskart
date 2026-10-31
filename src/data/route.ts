import { useEffect, useState } from 'react';

// Hash routes keep deep links and the Android back button working inside the Capacitor WebView.
const read = () => location.hash.replace(/^#/, '') || '/';

export function useRoute() {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const f = () => setRoute(read());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return route;
}

export const go = (path: string) => {
  if (read() !== path) location.hash = path;
  window.scrollTo(0, 0);
};
