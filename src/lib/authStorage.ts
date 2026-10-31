import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

/** Where the sign-in is kept. Browsers: localStorage, as before. Phone apps: the app's own storage
    (Android SharedPreferences, iOS UserDefaults), which the system does not wipe like WebView storage.
    A sign-in saved in WebView storage by an older app version moves across once, so nobody is signed out. */
export const nativeAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    const { value } = await Preferences.get({ key });
    if (value !== null) return value;
    let old: string | null = null;
    try { old = window.localStorage.getItem(key); } catch { /* storage blocked */ }
    if (old === null) return null;
    await Preferences.set({ key, value: old });
    try { window.localStorage.removeItem(key); } catch { /* storage blocked */ }
    return old;
  },
  async setItem(key: string, value: string): Promise<void> {
    await Preferences.set({ key, value });
  },
  async removeItem(key: string): Promise<void> {
    await Preferences.remove({ key });
    try { window.localStorage.removeItem(key); } catch { /* storage blocked */ }
  },
};

export const useNativeAuthStorage = Capacitor.isNativePlatform();
