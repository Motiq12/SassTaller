# Suite end-to-end de MOTIQ (Playwright)

Los 12 flujos críticos de punta a punta, en Chromium: registro del taller, login por rol,
cliente, vehículo, orden, diagnóstico, presupuesto, aprobación y rechazo en el portal,
reparación, entrega con factura, historial y separación entre talleres.

## Cómo corre

- Playwright levanta el backend en el puerto **3201** (`preparar-base.mjs` crea la base si
  falta y el backend la migra al arrancar) y `servidor-frontend.cjs` en el **4310**, que sirve
  el build de `frontend/www` con `/api` hacia el backend, igual que en producción.
- Cada worker crea **su propio taller** por `POST /api/onboarding` (`fixtures/taller.ts`).
  Los specs que caen en el mismo worker comparten ese taller, así que todo lo que la base
  exige único por taller (correos, placas, cuentas del portal) usa `taller.unico()`.
- La base es persistente: no se vacía entre corridas. Su nombre tiene que terminar en
  `_e2e` o `_test`, o `preparar-base.mjs` se niega a tocarla.
- Mailer en modo simulación, sin captcha y sin topes de peticiones. La única escritura
  directa en la base es `email_verificado = 1` al registrar un cliente del portal: es lo que
  haría el cliente al confirmar el código que le llega por correo.

## Local

```bash
docker exec motiq-pg18 createdb -U motiq motiq_t11_e2e   # una sola vez (o la crea la suite)
npm ci --prefix backend && npm ci --prefix frontend && npm ci --prefix e2e
npm run build --prefix frontend                          # la suite sirve frontend/www
cd e2e
npx playwright install chromium
npx playwright test                                      # o --headed / --ui
```

Otra base: `E2E_DATABASE_URL=postgres://usuario:clave@host:puerto/otra_e2e npx playwright test`.
Si cambiás el frontend, volvé a compilarlo antes de correr la suite.

## Lo que no pasa por la pantalla

- **Diagnóstico (flujo 6):** ninguna pantalla permite redactarlo, solo mostrarlo. Se escribe
  con `PUT /api/ordenes/:id` y la prueba verifica que el detalle lo muestra.
- **Preparación de datos:** clientes, vehículos, órdenes y cotizaciones de los flujos que no
  tratan de eso se crean por la misma API que usa el frontend. Cada flujo pasa por la
  pantalla en su parte central.
