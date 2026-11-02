import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();

// Links the phone hands to another app: WhatsApp, the dialler, email, Google Maps.
const OTHER_APP = /^(tel:|mailto:|sms:|whatsapp:|https:\/\/(wa\.me|api\.whatsapp\.com)\/|https:\/\/(www\.)?google\.[a-z.]+\/maps|https:\/\/maps\.(google|app\.goo)\.)/i;

/** Opens a link outside the app. In a browser: a new tab. In the phone apps: WhatsApp, phone or Maps
    go to their own app; anything else (a document, a website) opens in an in-app browser sheet. */
export async function openExternal(url: string) {
  if (!isNative) { window.open(url, '_blank', 'noopener'); return; }
  // leaving the WebView's own page hands the link to Android/iOS, which picks the right app
  if (OTHER_APP.test(url)) { window.location.href = url; return; }
  await Browser.open({ url });
}

/** Phone apps: links with target=_blank do nothing inside a WebView, so catch them and open them properly. */
export function routeExternalLinks() {
  if (!isNative) return;
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#') || href.startsWith('?')) return;
    let url: URL;
    try { url = new URL(href, location.href); } catch { return; }
    if (url.origin === location.origin && !/^(tel|mailto|sms):/.test(url.protocol)) return;
    e.preventDefault();
    openExternal(url.href);
  });
}

/** Phone apps: status bar icons dark on the light theme and light on the dark one, following the theme button. */
export function syncStatusBar() {
  if (!isNative) return;
  import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    // Android WebView older than Chrome 140 can't draw behind the status bar: Capacitor pads the page and the
    // bar keeps Android's white background, so its icons must stay dark whatever the theme
    const chrome = +(navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] ?? 999);
    const ownBar = Capacitor.getPlatform() !== 'android' || chrome >= 140;
    const apply = () => {
      const t = document.documentElement.getAttribute('data-theme');
      const dark = ownBar && (t ? t === 'dark' : media.matches);
      StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
    };
    apply();
    media.addEventListener('change', apply);
    new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  });
}

/** Phone apps: keep the field being typed in above the keyboard (plot sheet, finance forms). */
export function keepFieldsAboveKeyboard() {
  if (!isNative) return;
  import('@capacitor/keyboard').then(({ Keyboard }) => {
    Keyboard.addListener('keyboardDidShow', () => {
      const el = document.activeElement as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  });
}

/** Phone apps: no zooming. iOS zooms in when a small text box is tapped (the sign-in code) and never zooms back,
    which leaves the whole app a little too big and sliding sideways. Browsers keep pinch-zoom. */
export function lockZoom() {
  if (!isNative) return;
  document.querySelector('meta[name="viewport"]')
    ?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
}

/** Phone apps: the splash screen stays until the first screen has drawn. */
export function hideSplash() {
  if (!isNative) return;
  requestAnimationFrame(() => import('@capacitor/splash-screen').then(({ SplashScreen }) => SplashScreen.hide({ fadeOutDuration: 250 })));
}

/** Phone apps: a layout drawing from the camera or the gallery, as a File for the same upload and AI reading
    flow the browser uses. Returns null if the person backs out. */
export async function pickLayoutPhoto(source: 'camera' | 'photos'): Promise<File | null> {
  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
  try {
    const photo = await Camera.getPhoto({
      source: source === 'camera' ? CameraSource.Camera : CameraSource.Photos,
      resultType: CameraResultType.Uri,
      quality: 90,
      width: 3000, // plenty for the AI to read plot numbers, small enough to upload on mobile data
      correctOrientation: true,
      saveToGallery: false,
    });
    if (!photo.webPath) return null;
    const blob = await (await fetch(photo.webPath)).blob();
    return new File([blob], `layout.${photo.format || 'jpg'}`, { type: blob.type || 'image/jpeg' });
  } catch (e) {
    if (/cancel/i.test(String((e as Error)?.message ?? e))) return null;
    throw new Error('Could not open the camera. Check that Plotskart is allowed to use it in the phone settings.');
  }
}
