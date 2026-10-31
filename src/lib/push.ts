import { Capacitor } from '@capacitor/core';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { supabase } from './supabase';

let currentToken: string | null = null;
let openPlot: (plotId: string) => void = () => {};

async function saveToken(token: string) {
  currentToken = token;
  const { error } = await supabase.rpc('register_device', { p_token: token, p_platform: Capacitor.getPlatform() });
  if (error) console.warn('Could not register this phone for alerts');
}

const ASKED = 'plotskart-alerts-asked';
const asked = () => { try { return localStorage.getItem(ASKED) === '1'; } catch { return false; } };

/** Has this phone already been given permission for alerts? ('prompt' = not asked yet) */
export async function pushPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unsupported'> {
  if (!Capacitor.isNativePlatform()) return 'unsupported';
  try {
    const { receive } = await FirebaseMessaging.checkPermissions();
    if (receive === 'granted') return 'granted';
    // Android reports "denied" before it has ever asked, so only our own record tells the two apart
    if (receive === 'denied') return asked() ? 'denied' : 'prompt';
    return 'prompt';
  } catch { return 'unsupported'; }
}

async function connect() {
  if (Capacitor.getPlatform() === 'android') {
    // must match android.notification.channel_id sent by the deliver function
    await FirebaseMessaging.createChannel({ id: 'updates', name: 'Plot updates and reminders', importance: 4 });
  }
  const { token } = await FirebaseMessaging.getToken();
  await saveToken(token);
  await FirebaseMessaging.removeAllListeners();
  await FirebaseMessaging.addListener('tokenReceived', (e) => saveToken(e.token));
  await FirebaseMessaging.addListener('notificationActionPerformed', (e) => {
    const plotId = (e.notification.data as { plot_id?: string } | undefined)?.plot_id;
    if (plotId) openPlot(plotId);
  });
}

/** After sign-in: if alerts are already allowed on this phone, register it quietly. Never asks by itself;
    the permission question comes from the "Turn on alerts" card, when the person chooses. */
export async function registerPush(onOpenPlot: (plotId: string) => void) {
  openPlot = onOpenPlot;
  if ((await pushPermission()) !== 'granted') return;
  try { await connect(); } catch { console.warn('Push registration failed'); }
}

/** The "Turn on alerts" button: asks Android/iOS, then registers. Returns whether alerts are now on. */
export async function enablePush(): Promise<boolean> {
  try {
    const perm = await FirebaseMessaging.requestPermissions();
    try { localStorage.setItem(ASKED, '1'); } catch { /* storage blocked */ }
    if (perm.receive !== 'granted') return false;
    await connect();
    return true;
  } catch {
    console.warn('Push registration failed');
    return false;
  }
}

export async function unregisterPush() {
  if (!Capacitor.isNativePlatform() || !currentToken) return;
  await supabase.rpc('unregister_device', { p_token: currentToken });
  try { await FirebaseMessaging.deleteToken(); } catch { /* already gone */ }
  currentToken = null;
}
