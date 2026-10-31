import './storageMigration';
import { Capacitor } from '@capacitor/core';
import { createClient } from '@supabase/supabase-js';
import { nativeAuthStorage, useNativeAuthStorage } from './authStorage';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(url && key);

// Demo mode (?demo in the address): a private sample company, signed in per browser tab so a
// visitor can be the owner in one tab and a salesperson in another.
const params = new URLSearchParams(location.search);
const safeSession = (() => { try { return window.sessionStorage; } catch { return undefined; } })();
// The phone apps have no demo: it ends on the sales site, and store rules don't allow pointing people to purchases.
export const isDemo = !Capacitor.isNativePlatform() && (params.has('demo') || safeSession?.getItem('plotskart-demo') === '1');
if (isDemo) safeSession?.setItem('plotskart-demo', '1');

// Supabase keeps tabs that share a storage key signed in as the same person. Each demo tab gets its
// own key so the owner in one tab and a salesperson in another stay apart. A tab opened with a
// hand-over link (th=) is a new person, even though the browser copied the opener's session storage.
let demoTab = safeSession?.getItem('plotskart-demo-tab') ?? '';
if (isDemo && (!demoTab || params.has('th'))) {
  demoTab = Math.random().toString(36).slice(2, 10);
  safeSession?.setItem('plotskart-demo-tab', demoTab);
}
export const demoAuthKey = `plotskart-demo-auth-${demoTab}`;

export const supabase = createClient(url || 'http://localhost:54321', key || 'missing-anon-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    ...(isDemo && safeSession ? { storage: safeSession, storageKey: demoAuthKey } : useNativeAuthStorage ? { storage: nativeAuthStorage } : {}),
  },
});
