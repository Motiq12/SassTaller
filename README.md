# MS Motos — Gestión de taller

Sistema de gestión para un taller de motos: **citas**, **órdenes de trabajo**,
**portal de clientes**, **garantías**, **fidelización** y paneles por rol.

App **Ionic + Angular** (NgModules) con API **Node.js + Express 5** y base **MySQL 8.x**.
Desplegada en **Railway** (auto-deploy desde `main`).

```
Proyecto Taller/
├── frontend/   → App Ionic + Angular (navegador / móvil)
└── backend/    → API REST Express + MySQL
```

El frontend no toca MySQL directo: llama por HTTP a la API, y la API es la única
que abre conexiones a la base. En producción, Express también sirve el build de Angular.

```
[Ionic/Angular] --HTTP--> [Express API] --SQL--> [MySQL]
```

---

## Roles

Tres roles (jerarquía `recepcion` < `tecnico` < `admin`):

- **recepcion** — mostrador: clientes, órdenes de trabajo, cotizaciones, mensajería.
- **tecnico** (mecánico) — su agenda de citas, tareas asignadas, perfil.
- **admin** — panel `/admin` (resumen, citas, empleados, reportes, tareas, promociones)
  y el dashboard operativo `/tabs`.

Los clientes entran por el **portal** (`/portal`): registro, agenda de citas con cupos,
seguimiento de su moto, aprobación de presupuestos y calificación.

---

## Requisitos

- Node.js 18+
- MySQL Server 8.x
- Ionic CLI y Angular CLI

---

## 1. Base de datos

Con MySQL corriendo (en Laragon: **Start All**), importá la base del repo:

```bash
cd backend
npm install
npm run db:importar
```

Eso recrea la base `sasstaller` con el volcado `backend/db/sasstaller.sql`, que ya trae
el esquema al día y dos talleres de prueba. **Si ya la tenías, la reemplaza**: la idea es
que todos arranquen desde lo mismo. El detalle de qué trae está en
[`backend/db/README.md`](backend/db/README.md).

Después copiá `backend/.env.example` a `backend/.env` y completá los valores:

```
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=sasstaller
CORS_ORIGIN=http://localhost:8100
JWT_SECRET=                # obligatorio; en producción el server aborta si falta
RESEND_API_KEY=            # opcional; sin key, los códigos se imprimen en consola
```

Las cuentas vienen en el volcado (ver `backend/db/README.md`); el `.env` no está en el
repo porque lleva el `JWT_SECRET`, así que pedíselo a quien te pasó el proyecto.

Para entrar al panel de la plataforma necesitás crear tu propia cuenta, porque esas no
vienen en el volcado a propósito:

```bash
npm run motiq:admin -- "Tu nombre" vos@motiq.cr
```

> **Sobre las migraciones.** La API corre migraciones idempotentes (`ensureSchema`) en
> cada arranque, así que el esquema se mantiene al día solo en cada deploy. Los archivos
> de `backend/migrations/` son el registro de cómo se llegó hasta acá: **no los ejecuta
> ningún script** y el volcado ya los tiene aplicados. Solo hacen falta para entender un
> cambio o para migrar a mano una base vieja.

---

## 2. Backend (API)

```bash
cd backend
npm run dev        # recarga automática (nodemon), un solo proceso
# o
npm start          # multiproceso (cluster), como en producción
npm test           # tests unitarios
```

API en **http://localhost:3000**, montada bajo `/api` (auth, clientes, vehiculos, citas,
ordenes, recepcion, mecanico, admin, garantias, promos, portal, motiq…).

---

## 3. Frontend (Ionic)

En otra terminal, con el backend corriendo:

```bash
cd frontend
npm install
ionic serve                              # http://localhost:8100
npx ng build --configuration production  # build de producción
```

La URL de la API se configura en `frontend/src/environments/`.

---

## Deploy

Railway despliega automáticamente al hacer **push a `main`**. La API sirve el build
del frontend y ejecuta las migraciones al arrancar; no hay pasos manuales de base de datos.
