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
- PostgreSQL 16 (lo más simple: Docker Desktop, ver abajo)
- Ionic CLI y Angular CLI

---

## 1. Base de datos

La base es **PostgreSQL**. En desarrollo alcanza con un contenedor (se crea una vez):

```bash
docker run -d --name motiq-pg -e POSTGRES_USER=motiq -e POSTGRES_PASSWORD=motiq_dev \
  -e POSTGRES_DB=sasstaller -p 5432:5432 -v motiq-pg-data:/var/lib/postgresql/data postgres:16-alpine
```

Copiá `backend/.env.example` a `backend/.env`: ya trae los valores de ese contenedor.
Completá `JWT_SECRET` con cualquier texto largo (en producción el server aborta si falta).
Después:

```bash
cd backend
npm install
npm run db:importar
```

Eso recrea el esquema desde `backend/db/migraciones/`, carga dos talleres de prueba y
**genera contraseñas nuevas para el personal, que imprime una sola vez**: el repo no lleva
ninguna que funcione. **Si ya tenías la base, la reemplaza** —la idea es que todos arranquen
desde lo mismo— y por eso se niega a correr contra un servidor que no sea local. El detalle
está en [`backend/db/README.md`](backend/db/README.md).

Para entrar al panel de la plataforma necesitás tu propia cuenta (esas no vienen en los
datos de prueba, a propósito):

```bash
npm run motiq:admin -- "Tu nombre" vos@motiq.cr
```

> **Sobre las migraciones.** Cada cambio de esquema es un archivo numerado en
> `backend/db/migraciones/`, y la API aplica los pendientes al arrancar, una sola vez cada
> uno. La carpeta `backend/migrations/` es el registro de la etapa MySQL: no la ejecuta nada.

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
