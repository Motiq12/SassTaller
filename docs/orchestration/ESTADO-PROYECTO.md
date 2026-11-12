# MOTIQ · Estado del proyecto

- **Actualizado:** 2026-11-11.
- **Run de Orca:** `run_a7b76c2bd3ad`.
- **Base:** `main` en `5a23fe9`.
- **Hallazgos:** ver `AUDITORIA-INICIAL.md`.

Estados posibles: Pendiente · Lista · En progreso · Bloqueada · En revisión · Correcciones requeridas · Completada.

Cada tarea corre en un worktree propio que crea Orca, con su rama y su PR a `main`. Ningún agente mergea. El PR lo revisan el CTO y Antigravity, y lo mergea el propietario.

## Tablero

| ID | Tarea | Agente | Prio. | Estado | Depende de | Rama y worktree | Pruebas exigidas | Hallazgos | Resultado |
|---|---|---|---|---|---|---|---|---|---|
| A1 | Auditoría de backend, base y seguridad | Codex | — | Completada | — | `StiffOtarola/motiq-auditoria` | Solo lectura | B-01 a B-18 | Informe verificado por el CTO |
| A2 | Auditoría de frontend | OpenCode (GLM) | — | Completada | — | ídem | Solo lectura | F-01 a F-17 | Informe verificado por el CTO |
| A3 | Auditoría de QA, pruebas y CI | Antigravity | — | Completada | — | ídem | Solo lectura | Q-01 a Q-10 | Informe verificado por el CTO, con 2 correcciones |
| T01 | Respaldos: restauración PostgreSQL probada | Codex | P0 | Lista | — | La crea Orca al despachar | Respaldo y restauración en una base de prueba | B-16, B-17 | — |
| T02 | Dinero en órdenes | Codex | P0 | Lista | — | ídem | Tests y dos empresas | Q-03, Q-04, Q-05, Q-06, Q-08 | — |
| T03 | Las sesiones siguen a los permisos | Codex | P0 | Lista | — | ídem | El token viejo da 401 en cada caso | B-04, B-05, B-07, B-08 | — |
| T04 | Integridad entre talleres en las altas | Codex | P0 | Pendiente | T02, T03 | ídem | Pruebas negativas con IDs ajenos en el cuerpo | B-01, B-02, B-03 | — |
| T05 | Plataforma Motiq: 2FA y sesiones revocables | Codex | P1 | Pendiente | T03 | ídem | Login de plataforma con 2FA y revocación | B-06 | — |
| T06 | Frontend: código muerto y rutas rotas | OpenCode (GLM) | P1 | Lista | — | ídem | `ng build` y capturas | F-01, F-02, F-11, F-13 | — |
| T07 | Frontend: peso del login y estilos globales | OpenCode (GLM) | P1 | Pendiente | T06 | ídem | Bytes medidos antes y después | F-05, F-03 | — |
| T08 | Lint del frontend limpio y en CI | OpenCode (GLM) | P1 | Pendiente | T06, T07 | ídem | `ng lint` en 0 y paso en CI | Q-02 | — |
| T09 | Tests reales del frontend en CI | OpenCode (GLM) | P2 | Pendiente | T08 | ídem | Tests headless en CI | Q-01 | — |
| T10 | Diseño de la suite end-to-end de los 12 flujos | Antigravity | P1 | Lista | — | Solo lectura | — | Brecha de los 12 flujos | — |
| T11 | Suite Playwright en CI | OpenCode (GLM) | P1 | Pendiente | T10, T02, T03 | ídem | Los 12 flujos en verde y job en CI | Brecha de los 12 flujos | — |
| T12 | Concurrencia: códigos de un solo uso y cupos | Codex | P2 | Pendiente | T04 | ídem | Pruebas concurrentes por HTTP | B-09, B-13 | — |
| T13 | Endurecimiento | Codex | P2 | Pendiente | T04 | ídem | Tests, y EXPLAIN para el índice | B-10, B-11, B-12, B-14, B-18 | — |
| P1 | Encender respaldos en producción | Propietario | P0 | Bloqueada: decisión | T01 | Railway | Primer respaldo OK y restauración de prueba | B-16 | — |
| P2 | Staging en Railway y protección de `main` | Propietario | P0 | Bloqueada: decisión | — | GitHub y Railway | — | Deuda | — |
| P3 | Cambio de configuración de Railway (vence el 2026-12-01) | Propietario | P0 | Bloqueada: decisión | — | Railway | Deploy OK después del cambio | Deuda | — |
| P4 | Dirección visual del panel (GPT-6) | Propietario | P2 | Pendiente | — | — | — | F-08, F-09, F-10 | — |

## Olas de trabajo

Hay como máximo tres trabajadores a la vez, y nunca dos en los mismos archivos.

| Ola | Tareas en paralelo | Por qué pueden ir juntas |
|---|---|---|
| 1 | T01 (Codex), T02 (Codex) y T03 (Codex) | Tocan archivos distintos: respaldo y migrador; órdenes, garantías y costos; sesiones y middlewares. Cada una usa su propia base de prueba. |
| 1b | T10 (Antigravity) | Es solo lectura y no edita archivos. |
| 2 | T04 (Codex), T06 (OpenCode) y T05 (Codex) | T04 necesita T02 y T03 ya en `main`. T06 es solo frontend. T05 solo toca la plataforma. |
| 3 | T07, T11 y T12 | Ver dependencias. |
| 4 | T08, T13 y T09 | — |

Después de cada ola:
1. El CTO revisa los diffs.
2. Antigravity audita cada PR en un worktree de solo lectura.
3. El propietario mergea.
4. Las ramas siguientes se rebasan sobre el `main` nuevo y se revalidan.

## Aislamiento de entornos

- **Base de pruebas:** cada tarea usa la suya, `motiq_<id>_test` y `motiq_<id>_e2e`, en el Postgres local de Docker. Nunca usa producción.
- **Credenciales:** ningún worktree recibe credenciales de producción, y los `.env` no se comparten.
- **Puertos:** cada tarea que levante servidores usa un puerto distinto. El backend de pruebas usa 3199 y el frontend 4300 o más.
