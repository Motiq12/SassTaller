# MOTIQ · Auditoría técnica inicial

- **Fecha:** 2026-11-11
- **Base auditada:** `main` en `5a23fe9`, que ya incluye los PR #1 a #27.
- **Run de Orca:** `run_a7b76c2bd3ad`.
- **Modalidad:** solo lectura. No se modificó código, no se tocó producción y no se corrieron pruebas contra bases compartidas.

Cada hallazgo indica quién lo encontró y si el CTO lo verificó leyendo el código.
- **CONFIRMADO** quiere decir que se puede demostrar con el código.
- **HIPÓTESIS** quiere decir que hace falta ejecutarlo en un entorno desechable para saberlo.

Ningún hallazgo se reprodujo en producción.

---

## 1. Resumen ejecutivo

MOTIQ está en buen estado técnico para su tamaño.
- **Base:** separa los talleres en cada consulta y tiene una prueba real de dos empresas contra Postgres 18. La pasan 150 comprobaciones.
- **Pruebas:** 333 tests del backend en verde y CI en cada PR.
- **Dependencias:** 0 vulnerabilidades en las de producción.
- **Producción:** sana en Railway.

**Todavía no está listo para una beta con clientes reales.** Hay cuatro bloqueos:

1. **La base de producción no tiene respaldos.** El respaldo nocturno está programado en el código, pero faltan sus variables en Railway, y la guía de restauración todavía describe MySQL.
2. **Integridad entre talleres.** Las altas de órdenes y citas aceptan clientes, vehículos y técnicos de otro taller. No se llegan a mostrar, pero los datos quedan cruzados.
3. **Las sesiones no siguen a los permisos.** Cambiar el rol de un empleado, desactivar el portal de un cliente o cambiar la clave de una cuenta de Motiq no corta las sesiones abiertas.
4. **Errores que tocan dinero.**
   - Se pueden agregar repuestos a una orden ya entregada.
   - Un adicional que el cliente rechazó sigue sumando al total.
   - Se aceptan reclamos de garantía vencidos o repetidos.

Además, no hay entorno de staging, el frontend no tiene pruebas reales y no hay pruebas end-to-end.

---

## 2. Arquitectura

| Capa | Tecnología | Notas |
|---|---|---|
| Frontend | Angular 20 con NgModules, Ionic 8, Capacitor 8, TypeScript 5.9 y SCSS | Unas 24.600 líneas en 27 carpetas de pantallas. Carga diferida en todos los módulos y precarga por rol. |
| Backend | Node 22 y Express 5, en cluster de 2 procesos | Unas 17.800 líneas, con 24 routers y 50 utilidades. Jobs para recordatorios, no-show, vencimientos y respaldo. |
| Base de datos | PostgreSQL 18.6 en Railway, con conexión privada | 7 migraciones numeradas que se aplican al arrancar. La app usa un rol sin privilegios de superusuario. |
| Multi-taller | `tenant-db.js`, que usa `req.db` con `@tenant` y una guardia que exige `tenant_id` | La guardia mira el texto de la consulta, no su efecto: ver B-15. |
| Despliegue | Railway con Nixpacks, más dominio y DNS en Cloudflare | Sin el proxy de Cloudflare, a propósito. Cada push a `main` despliega directo a producción. |
| Correo | Resend, con el dominio motiq12.com verificado | — |
| CI | GitHub Actions: tests del backend, prueba de dos empresas y build del frontend | No corre lint, tests del frontend ni pruebas end-to-end. |

**Servicios apagados en producción** porque faltan sus variables:
- Respaldos, con las variables `RESPALDO_S3_*`.
- Captcha, con `TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET`.
- Entrar con Google, con `GOOGLE_CLIENT_ID`.
- Fotos en R2, con `R2_*`. Hoy las fotos van dentro de la base.
- Alertas de seguridad por Telegram, con `MONITOR_CLAVE`.

---

## 3. Estado de los agentes y de Orca (Fase 0)

| Pieza | Versión | Modelo efectivo | Prueba real |
|---|---|---|---|
| Orca | 1.4.256 | — | Runtime listo, con el repo `Motiq12` registrado. |
| Claude Code (CTO) | 2.1.322 | Opus 5.5 | Coordina este Run. |
| Codex (backend) | 0.167.1 | gpt-6-astra | Respondió la prueba y entregó la auditoría A1 por Orca. |
| OpenCode (frontend) | 2.1.3 | `opencode/glm-5.3-flash-free` | El modelo existe en el catálogo, quedó fijado en el worker y entregó la auditoría A2. |
| Antigravity (QA) | agy 1.5.6 | Gemini 3.8 Flash | Respondió la prueba y entregó la auditoría A3. En Windows, Orca lo corre como terminal y no como chat. |
| GPT-6 (UI/UX) | — | — | Es externo: no está conectado a Orca. Sus decisiones llegan por medio del propietario. |

Codex muestra avisos de servidores MCP sin autenticar, como Cloudflare, Motion y Vercel. No afectan su trabajo.

---

## 4. Inventario de módulos

### Backend, según Codex en A1 con revisión del CTO

| Módulo | Estado | Motivo |
|---|---|---|
| auth.routes, middlewares de sesión | Defectuoso | Problemas B-03, B-04, B-07 y B-08, más la carrera B-09. |
| usuarios.routes | Defectuoso | Cambiar el rol no corta la sesión (B-04). |
| ordenes.routes, citas.routes | Defectuoso | Las altas aceptan registros de otro taller (B-01) y la reserva de cupos tiene una carrera (B-13). |
| clientes.routes | Defectuoso | Desactivar el portal no corta las sesiones (B-05). |
| vehiculos.routes | Defectuoso | El alcance por rol y por sede está incompleto (B-10). |
| recepcion.routes, mecanico.routes | Defectuoso | Las rutas viejas no validan los registros a los que apuntan (B-02). |
| portal.routes | Parcial | Problemas B-05, B-09 y B-13. |
| motiq.routes (plataforma) | Parcial | Sin segundo factor ni sesiones revocables (B-06). |
| garantias, reglas de orden | Defectuoso | Problemas Q-03, Q-04, Q-05, Q-06 y Q-08. |
| Respaldo | Parcial | El código está y tiene pruebas, pero en producción está apagado y no hay restauración probada para Postgres (B-16 y B-17). |
| mailer | Parcial | Sin clave de Resend, simula el envío y escribe el código en el registro (B-18). |
| admin, dashboard, marca, directorio, metricas, monitor, reportes, avisos, mensajeria | Implementado sin pruebas suficientes | Acotados al taller y sin defectos confirmados. |

### Frontend, según OpenCode en A2 con verificación del CTO

| Área | Estado |
|---|---|
| Landing, registro de taller, legal, acceso (login, registro, recuperar, buscador) | Terminada |
| Panel admin, recepción, mecánico, portal del cliente, detalle de orden, factura, garantías | Terminada. `detalle-orden`, `admin-config` y `motiq-panel` son componentes monolíticos de más de 80 KB. |
| Panel de Motiq | Terminado, con una paleta propia que no sigue el tema (F-08). |
| Panel viejo `/tabs` (dashboard, ordenes, citas), `promos` | Parcial o viejo: sigue accesible por URL directa y duplica pantallas vivas. |
| `vehiculo-form`, `vehiculo-historial`, `vehiculos`, `motos`, `recepcion-clientes`, `portal-vehiculos`, `portal-vehiculo-historial` | Código muerto. Verificado: no tienen ninguna referencia fuera de su carpeta. |

### Pruebas, según Antigravity en A3

- **Backend:** 51 archivos de test, 333 tests en verde, más la prueba de dos empresas con Postgres real.
- **Frontend:** 17 archivos `*.spec.ts`, todos con el esqueleto que genera Angular. No corren en CI y fallarían por inyección.

Cobertura de los 12 flujos críticos:

| Flujo | Cobertura |
|---|---|
| Registro de taller | Parcial |
| Login | Cubierto en el backend |
| Registro de cliente | Parcial |
| Registro de vehículo | Parcial |
| Creación de orden | Parcial |
| Diagnóstico | Parcial |
| Presupuesto | Cubierto en el backend |
| Aprobación del cliente | Parcial. **Sin prueba de aprobar o rechazar desde el portal.** |
| Reparación | Parcial |
| Entrega | Cubierta en el backend |
| Historial | Parcial |
| Separación entre talleres | Cubierta, con los límites de la sección 5. |

Ningún flujo tiene una prueba end-to-end en el navegador.

---

## 5. Problemas confirmados

En la columna "Verif.", ✔ quiere decir que el CTO lo leyó en el código.

### Bloquean la beta

| ID | Sev. | Hallazgo | Evidencia | Verif. |
|---|---|---|---|---|
| B-16 | **Crítico** | La base de producción no se respalda. Faltan las variables `RESPALDO_S3_ENDPOINT`, `RESPALDO_S3_BUCKET`, `RESPALDO_S3_ACCESS_KEY_ID` y `RESPALDO_S3_SECRET_ACCESS_KEY`. | Registro de producción: «💾 Respaldo automático SIN CONFIGURAR»; `backend/src/services/respaldo.js:22` | ✔ |
| B-17 | Alto | La guía de restauración usa comandos de MySQL. El volcado excluye `schema_migraciones`, y la invocación sugerida del migrador no lo ejecuta. Nunca se probó una restauración. | `docs/RESPALDOS.md:93-125`; `backend/src/utils/volcado.js:23`; `backend/src/db/migrar.js:97` | — |
| B-01 | Alto | Las altas de órdenes y citas, la edición de citas y `/asignar` aceptan `cliente_id`, `vehiculo_id`, técnico y sede de otro taller. Tampoco validan que el vehículo sea de ese cliente. | `backend/src/routes/ordenes.routes.js:109-147`; `citas.routes.js:94,114,218,346` | ✔ |
| B-04 | Alto | Cambiar el rol no cierra la sesión: `requireRol` usa el rol que quedó firmado en el token, que dura 8 horas. | `usuarios.routes.js:112-149`; `middleware/roles.js:6` | ✔ |
| B-05 | Alto | Desactivar el portal solo borra la contraseña. Las sesiones, el código por correo y Google siguen entrando. | `clientes.routes.js:124-145`; `portal.routes.js:203,499,529` | — |
| B-06 | Alto | La cuenta de plataforma de Motiq entra solo con contraseña, sin segundo factor. Su token, válido por 8 horas, no se revoca al cambiar la clave. | `motiq.routes.js:31,57,1084`; `auth-plataforma.js:45` | — |
| Q-03 | Alto | Se pueden agregar, editar y borrar repuestos y costos de órdenes entregadas o canceladas. | `ordenes.routes.js:539-620`; `recepcion.routes.js:592-625` | ✔ |
| Q-04 | Alto | Un adicional rechazado por el cliente sigue sumando al total. Solo se avisa «quitá lo que no aprobó». | `backend/src/utils/ordenes.js:243-280` | ✔ |
| Q-05 | Alto | Se aceptan reclamos de garantía vencidos o repetidos. | `garantias.routes.js:84-86` | ✔ |

### Importantes

| ID | Sev. | Hallazgo |
|---|---|---|
| B-02 | Medio | Las rutas viejas de notificar, mensajes y cortesía aceptan referencias de otro taller. |
| B-07 | Medio | El token del alta del taller no tiene identificador de sesión, así que cerrar sesión no lo invalida. |
| B-08 | Medio | Si falla la consulta que revisa las sesiones, el token se acepta igual. |
| B-10 | Medio | Un técnico puede editar vehículos fuera de sus órdenes, y el historial ignora la sede. |
| B-11 | Medio | La validación de imágenes no revisa el contenido real. La foto del mecánico y la imagen de promos no tienen límite propio. |
| B-12 | Medio | El límite de intentos por cuenta vive en la memoria de cada proceso, y el login del portal no tiene límite por cuenta. |
| B-18 | Medio | Sin clave de Resend, el mailer simula el envío y escribe el código en el registro. Hoy no pasa en producción, porque la clave está cargada. |
| Q-06 | Medio | Si se cancela una orden, la cortesía de fidelización usada no se le devuelve al cliente. |
| Q-07 | Medio | Cambiar el estado de una cita que ya tiene orden deja la cita y la orden desincronizadas. |
| Q-08 | Medio | El cierre administrativo entrega una orden desde cualquier estado. |
| Q-01 | Medio | Los 17 tests del frontend son esqueletos y no corren en CI. Antigravity lo marcó Crítico; el CTO lo baja a Medio porque no rompe nada en producción. |
| Q-02 | Medio | El lint del frontend no corre en CI. Ojo: `ng lint` tiene hoy unos 344 errores previos, así que no se puede activar sin limpiarlos antes. |
| F-05 | Medio | El dibujo `assets/portal/taller-iso.svg` pesa 492 KB y lo descarga cada visitante del login. Verificado. |
| F-03 | Medio | `global.scss` pesa 82 KB y entra en la carga inicial de toda la app, landing incluida. Verificado. |
| F-01 | Medio | Siete carpetas de pantallas son código muerto, y conviven nombres `moto-*` con `vehiculo-*`. Verificado. OpenCode lo marcó Alto; el CTO lo baja porque no afecta al usuario. |
| F-02 | Medio | `/admin/web` redirige a una ruta que no existe. Hoy está latente, porque el sitio web está apagado. Verificado. |

### Menores

- **B-03:** la sede de las preferencias se valida sin acotar al taller.
- **B-14:** falta un índice compuesto `(tenant_id, fecha_ingreso)` en órdenes.
- **B-15:** la guardia de `tenant_id` revisa el texto de la consulta, y el migrador no verifica la base inicial.
- **Q-09:** falta poder registrar en recepción el rechazo verbal de un presupuesto.
- **F-06:** el frontend tiene 615 usos de `any`.
- **F-07:** 52 suscripciones tragan el error sin hacer nada.
- **F-08:** el panel de Motiq usa una paleta propia.
- **F-09:** el inicio del portal tiene colores escritos a mano.
- **F-10:** `DESIGN.md` todavía describe a MS Motos.
- **F-11:** hay dos pantallas de promociones.
- **F-12:** el panel viejo `/tabs` sigue vivo.
- **F-13:** el botón "Ver garantías" rebota a recepción.
- **F-16:** hay componentes monolíticos.

---

## 6. Riesgos potenciales (hipótesis, a probar en un entorno desechable)

- **B-09:** dos pedidos simultáneos podrían usar el mismo código de un solo uso: 2FA, código por correo o recuperación.
- **B-13:** dos reservas simultáneas podrían pasar el cupo de una franja.
- **Q-10:** `fecha_listo` no se limpia si la orden vuelve a reparación.
- **Límites de la prueba de dos empresas:**
  - El barrido de escrituras solo prueba IDs ajenos en la URL, no en el cuerpo del pedido.
  - Varios tokens de la prueba se fabrican sin pasar por el login.
  - Dos casos podrían pasar porque la ruta no existe, y no porque la seguridad funcione.
- **Sin staging:** cada merge a `main` va directo a producción.

---

## 7. Deuda técnica

- No hay entorno de staging, y `main` no tiene protección en GitHub.
- No hay pruebas del frontend ni pruebas end-to-end. El lint tiene unos 344 errores acumulados.
- Hay componentes monolíticos: `detalle-orden`, `admin-config` y `motiq-panel`.
- El tipado es débil, con 615 usos de `any`.
- Conviven el panel viejo `/tabs`, las pantallas duplicadas y el código muerto.
- `DESIGN.md` está desactualizado y no hay un sistema de diseño único para el panel.
- **Hay que cambiar el formato de configuración de Railway antes del 2026-12-01**, porque deja de aceptar `railway.json`.
- El trabajo de fotos en R2 está a medias, sin commitear, en el checkout principal. Ese checkout está 94 commits atrás de `main`.

---

## 8. Priorización y recomendaciones

1. **Recuperar la información:** encender los respaldos, rehacer la guía de restauración para Postgres y hacer un simulacro de restauración.
2. **Integridad de datos y dinero:** B-01, B-02, Q-03, Q-04, Q-05, Q-06 y Q-08.
3. **Sesiones y permisos:** B-04, B-05, B-07 y B-08, y después B-06 para la plataforma.
4. **Red de seguridad para cambiar con confianza:** staging, protección de `main`, pruebas end-to-end de los 12 flujos y limpieza del lint para poder activarlo en CI.
5. **Rendimiento y limpieza del frontend:** F-05, F-03, F-01, F-02 y F-11.
6. **Calidad visual del panel:** necesita una dirección de diseño aprobada por el propietario con GPT-6. Hoy no existe un documento de diseño vigente.

---

## 9. Plan de desarrollo

El backlog, las dependencias y las olas de trabajo están en `ESTADO-PROYECTO.md`. Cada tarea:
- Corre en su propio worktree, creado por Orca con `worker-start`.
- Tiene una rama propia y llega a `main` por PR.
- Pasa revisión del CTO y, cuando corresponde, auditoría de Antigravity.
- Pasa el CI completo.

Las tareas que tocan los mismos archivos van en secuencia. Por ejemplo, B-01 y Q-03 a Q-08 comparten `ordenes.routes.js`.

---

## 10. Distribución de responsabilidades

| Rol | Agente | Toma |
|---|---|---|
| Dirección, revisión e integración | Claude Code | Specs, revisión de diffs, verificación de evidencia y PR. Nunca aprueba su propio código sin el CI. |
| Backend y base | Codex | B-01 a B-18 y Q-03 a Q-10, migraciones no destructivas y pruebas negativas entre talleres. |
| Frontend | OpenCode con GLM-5.3-Flash Free | F-01 a F-16, tests reales del frontend, limpieza del lint y suite Playwright. |
| QA | Antigravity | Revisión independiente de cada PR, diseño de casos end-to-end y verificación de criterios. No implementa. |
| Dirección visual | GPT-6, vía el propietario | Sistema de diseño del panel y revisión visual. |
| Decisiones y producción | Propietario | Variables y servicios en Railway, staging, merges a `main` y lanzamiento. |
