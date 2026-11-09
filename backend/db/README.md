# Base de datos

La base de Motiq es **PostgreSQL**. Acá vive todo lo necesario para que cualquiera
del equipo la tenga igual haciendo `git pull`.

| Archivo | Qué es |
|---|---|
| `migraciones/NNNN_*.sql` | El esquema. Cada cambio es un archivo numerado que corre una sola vez. |
| `datos-prueba.sql` | Dos talleres de prueba, sin contraseñas que funcionen. |
| `credenciales.js` | El centinela que reemplaza las contraseñas en lo que va al repo. |
| `importar.js` / `exportar.js` | `npm run db:importar` / `npm run db:exportar`. |
| `sasstaller.sql` | El último volcado de la etapa MySQL. Histórico: de ahí salió `0001_esquema_base.sql` (ver `scripts/convertir-volcado-a-postgres.js`). No lo carga nada. |

## Levantarla

Con Postgres corriendo (el contenedor de desarrollo está en el README principal) y
`backend/.env` copiado de `.env.example`:

```bash
cd backend
npm run db:importar
```

Recrea el esquema `public` desde cero, aplica las migraciones, carga `datos-prueba.sql`
y **genera una contraseña nueva para cada persona del personal, que imprime una sola
vez**. Si las perdés, volvé a correrlo.

**Borra todo lo que haya en la base**, y por eso se niega a correr si la base no es
local (el `migrate.js` que había antes borraba la base entera si alguien lo apuntaba a
Railway). Para una base remota de pruebas, sabiendo lo que se hace:
`npm run db:importar -- --remota`.

## Qué trae

| Taller | Slug | Atiende |
|---|---|---|
| MS Motors | `ms-motors` | Motocicletas |
| Moto Zone | `moto-zone` | Motocicletas |

Los dos tienen un admin con el **mismo correo** (`admin@taller.com`) a propósito: es la
demostración de que un correo puede repetirse entre talleres. Al entrar, indicá el taller
(campo `taller` en el login) o el sistema lo resuelve por la contraseña.

Los clientes de prueba no tienen contraseña: entran con el código que llega al correo
(sin `RESEND_API_KEY`, el código se imprime en la consola del backend).

## Por qué no hay contraseñas en el repo

El volcado de la etapa MySQL llevaba los hashes de `Admin2024!` y `Recep2024!`, que además
estaban escritas en el README: cualquiera que clonara el repo tenía una cuenta admin servida.
Y un hash commiteado no se borra: queda en el historial de git.

Ahora todo lo que va al repo lleva el centinela de `credenciales.js` en vez del hash. No es
un hash de bcrypt válido, así que si alguien carga el archivo a mano sin pasar por el import,
ninguna contraseña entra: falla cerrado. Por la misma razón no viajan los códigos de un solo
uso (verificación, login, recuperación).

## Entrar al panel de Motiq

El panel de la plataforma (`/api/motiq`) ve **todos** los talleres, así que esas cuentas no
vienen en los datos de prueba. Creá la tuya:

```bash
npm run motiq:admin -- "Tu nombre" vos@motiq.cr
```

Imprime una contraseña generada **una sola vez**. Si la perdés, corré lo mismo con el mismo
correo y te la cambia.

## Cambiar el esquema

Un archivo nuevo en `migraciones/` con el número siguiente (`0002_descripcion.sql`).
Nunca se edita una migración que ya corrió en alguna base: se escribe otra que la corrija.
Si agrega una tabla con `tenant_id`, sumala a `TABLAS_CON_TENANT` en
`src/db/tenant-db.js` (el arranque avisa si no coinciden). El detalle está al principio de
`src/db/migrar.js`.

## Actualizar los datos de prueba

```bash
npm run db:exportar
```

Escribe los datos de tu base local en `datos-prueba.sql` (solo datos: el esquema vive en las
migraciones), sin cuentas de plataforma, sin contraseñas y sin códigos de un solo uso.

> **Antes de commitear, revisá qué hay adentro.** Lo que se commitea queda en el historial
> para siempre. Hoy son datos de prueba; exportar una base con talleres reales subiría
> nombres, teléfonos, cédulas y correos de sus clientes.

## Producción (Railway)

- La app se conecta con `DATABASE_URL` como el rol `motiq_app`, que solo lee y escribe
  filas: no puede crear, alterar ni borrar tablas, ni ejecutar comandos en el servidor.
  Lo crea `node scripts/crear-usuario-app.js`, que además lo pone a prueba.
- Las migraciones corren al arrancar con `MIGRACION_DATABASE_URL`, la del dueño del esquema.
- Respaldo: `npm run backup` (pg_dump; si no está instalado usa Docker). Restaurar:
  `pg_restore --clean --if-exists --no-owner -d "postgres://…" archivo.dump`.
