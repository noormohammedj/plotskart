import { useEffect, useState } from 'react';
import { isNative } from '../lib/native';

/** Phone apps: a strip across the top while the phone has no internet. Nothing is saved offline. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if (!isNative) return;
    let remove: (() => void) | undefined;
    import('@capacitor/network').then(async ({ Network }) => {
      setOffline(!(await Network.getStatus()).connected);
      const h = await Network.addListener('networkStatusChange', (s) => setOffline(!s.connected));
      remove = () => h.remove();
    });
    return () => remove?.();
  }, []);
  if (!offline) return null;
  return <div className="offline" role="status">You're offline. Bookings and payments can't be saved until the internet is back.</div>;
}
