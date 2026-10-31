import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Change appId to your own reverse domain before the first store upload; it cannot change later.
  appId: 'in.plotskart.app',
  appName: 'Plotskart',
  webDir: 'dist',
  backgroundColor: '#0B1418',
  plugins: {
    // shown until the first screen draws (hideSplash in src/lib/native.ts); 3 s is only the fallback
    SplashScreen: { launchShowDuration: 3000, launchAutoHide: true, backgroundColor: '#0B1418', showSpinner: false },
    Keyboard: { resizeOnFullScreen: true },
    FirebaseMessaging: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
