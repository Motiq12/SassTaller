import { defineConfig } from '@playwright/test';

// Puertos propios de la suite E2E: nunca 3199 ni 4300-4302 (los usa T10 y el
// servidor de desarrollo). El backend queda en 3201 y el frontend en 4310.
const PUERTO_API = 3201;
const PUERTO_WEB = 4310;
const URL_API = `http://127.0.0.1:${PUERTO_API}`;
const URL_WEB = `http://127.0.0.1:${PUERTO_WEB}`;

// Base persistente de la suite (no se borra por corrida: los datos de cada
// taller quedan, pero cada worker crea SU taller con slug y correos únicos).
export const DATABASE_URL =
  process.env.E2E_DATABASE_URL || 'postgres://motiq:motiq_dev@127.0.0.1:5433/motiq_t11_e2e';

export default defineConfig({
  testDir: './specs',
  timeout: 90_000,
  expect: { timeout: 12_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  workers: 2,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: URL_WEB,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
  },
  webServer: [
    {
      // Primero se crea la base si falta (preparar-base.mjs): Playwright levanta
      // los webServer antes de cualquier globalSetup. El backend la migra solo al
      // arrancar; con RATE_* en un millón no hay tope de peticiones y el mailer
      // queda en modo simulación (sin RESEND_API_KEY).
      command: 'node ../e2e/preparar-base.mjs && node src/server.js',
      cwd: '../backend',
      url: `${URL_API}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 150_000,
      env: {
        ...process.env,
        PORT: String(PUERTO_API),
        DATABASE_URL,
        MIGRACION_DATABASE_URL: DATABASE_URL,
        JWT_SECRET: process.env.JWT_SECRET || 'secreto-solo-para-e2e-motiq',
        RESEND_API_KEY: '',
        TURNSTILE_SECRET: '',
        TURNSTILE_SECRET_KEY: '',
        MOTIQ_ADMIN_EMAIL: '',
        MOTIQ_ADMIN_PASSWORD: '',
        RATE_API_MAX: '1000000',
        RATE_AUTH_MAX: '1000000',
        RATE_ADMIN_MAX: '1000000',
        NODE_ENV: 'development',
        // Sin recordatorios ni tareas de fondo: la suite no depende del reloj.
        DISABLE_CRON: '1',
      },
    },
    {
      // Servidor estático propio con el build de Angular (frontend/www) y
      // proxy de /api hacia el backend: así environment.prod.ts (apiUrl "/api")
      // funciona same-origin, igual que en producción.
      command: 'node servidor-frontend.cjs',
      cwd: './',
      url: URL_WEB,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        ...process.env,
        PUERTO: String(PUERTO_WEB),
        DESTINO_API: URL_API,
      },
    },
  ],
});
