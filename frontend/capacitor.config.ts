import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cr.motiq.app',
  appName: 'Motiq',
  webDir: 'www',
  // Sin `server.url`: la app carga su shell desde los assets locales del dispositivo
  // (offline real). Las llamadas a la API van al backend absoluto (ver native-config.ts).
  plugins: {
    // Splash generado con `npx capacitor-assets generate` (fuentes en assets/).
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#1e3a5f',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
  },
};

export default config;
