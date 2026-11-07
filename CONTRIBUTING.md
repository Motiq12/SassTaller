# Cómo trabajamos en este repo

`main` es producción: Railway despliega cada commit que llega ahí, y la API
corre las migraciones al arrancar. Estas reglas son para que varias personas
trabajen a la vez sin pisarse y sin romper lo que el taller está usando. Si
alguna estorba, se cambia aquí mismo con un PR.

## Antes de empezar

- `git pull` en `main` y un vistazo a los PR abiertos. Si alguno toca lo mismo,
  se habla antes de empezar.

## Ramas y PR

- Todo entra por PR, nada directo a `main`. Fusionar es desplegar.
- Una rama por tarea, que viva horas o un par de días. Mientras más dura, más
  choca.
- Un PR hace una sola cosa.
- Si un PR se apoya en otro que sigue abierto, dilo en la descripción y
  fusiónalos en ese orden.
- Se fusiona con el CI en verde: los tests del backend y el build del frontend.
- La rama se borra al fusionar.

## Antes de abrir el PR

- En `backend/`: `npm test`.
- En `frontend/`: `npm run build`.

## Base de datos

- Los cambios de esquema van en `backend/src/db/auto-migrate.js` y tienen que
  poder correr dos veces sin fallar: se ejecutan en cada arranque, contra la
  base real.
- `backend/.env` y `backend/backups/` no se versionan: tienen credenciales y
  datos reales de clientes.

## Cambios que van con el sitio web

El sitio ([msmotors-web](https://github.com/Taller-MS-Motors/msmotors-web)) lee
de `/api/sitio/` lo que el dueño publica en el panel y manda ahí las consultas
de sus formularios. Cuando un cambio necesita las dos partes:

- Primero se fusiona y se despliega el PR de este repo. Después se publica el
  sitio.
- No se cambia ni se quita un campo de `/api/sitio/` sin revisar qué lee el
  sitio.
- Cada PR enlaza a su pareja en el otro repo.

## Commits

`tipo(ámbito): descripción`, en español, como el resto del historial:
`feat(citas): ...`, `fix(orden): ...`, `docs(api): ...`.
