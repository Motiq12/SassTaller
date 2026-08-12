# Base de datos

Acá vive la base del proyecto, para que cualquiera del equipo la tenga igual
haciendo `git pull` en vez de esperar que alguien le pase un archivo.

## Levantarla

Con MySQL corriendo (en Laragon: **Start All**):

```bash
cd backend
npm run db:importar
```

Eso recrea la base `sasstaller` con el contenido de `sasstaller.sql`. Si ya la
tenías, **la reemplaza**: el resultado tiene que ser idéntico para todos, no "lo
del repo encima de lo que ya tenías".

Después falta `backend/.env`, que **no está en el repo** porque lleva el
`JWT_SECRET` y las contraseñas semilla. Copiá `.env.example` a `.env` y pedile
los valores a quien te pasó el proyecto.

## Qué trae

Dos talleres, que son los que hacen falta para trabajar y para ver que el
aislamiento funciona:

| Taller | Slug | Atiende |
|---|---|---|
| MS Motors | `ms-motors` | Motocicletas |
| Moto Zone | `moto-zone` | Motocicletas |

Los dos tienen un admin con el **mismo correo** (`admin@taller.com`) a propósito:
es la demostración de que un correo puede repetirse entre talleres. Al entrar,
indicá el taller (campo `taller` en el login) o el sistema lo resuelve por la
contraseña.

## Entrar al panel de Motiq

El panel de la plataforma (`/api/motiq`) es aparte de los talleres: se ven **todos**
desde ahí, así que esas cuentas **no vienen en el volcado** — la tabla llega vacía
a propósito. Creá la tuya:

```bash
npm run motiq:admin -- "Tu nombre" vos@motiq.cr
```

Imprime una contraseña generada **una sola vez** (en la base queda solo el hash).
Si la perdés, volvé a correr lo mismo con el mismo correo y te la cambia.

## Actualizar el volcado

Cuando cambie el esquema o los datos base:

```bash
npm run db:exportar
```

Y se commitea el `sasstaller.sql` resultante.

> **Antes de exportar, revisá qué hay adentro.** Este archivo va al repo, y lo que
> se commitea queda en el historial de git para siempre — aunque después lo borres.
> Hoy solo hay datos de prueba. El día que haya talleres reales usando el sistema,
> exportar sin mirar sube nombres, teléfonos, cédulas y correos de sus clientes.
> Si llega ese día, lo correcto es exportar solo la estructura (`--no-data`) y dejar
> que cada quien cree sus datos.

## Migraciones

`migrations/` tiene los cambios de esquema en orden:

- `001-multitenant.sql` — `tenant_id` en todas las tablas
- `002-vehiculos.sql` — `motos` pasa a `vehiculos`, con tipo y atributos
- `003-marca-por-taller.sql` — color de marca por taller
- `004-plataforma.sql` — cuentas de Motiq, y estado/plan de cada taller

El volcado ya las tiene aplicadas: solo hacen falta para entender cómo se llegó
acá, o para migrar una base vieja.
