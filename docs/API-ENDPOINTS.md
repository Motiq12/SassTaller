# Documentación de la API — Sistema MS Motos

Referencia **completa** de los endpoints del sistema: **249 rutas** agrupadas por módulo,
más el chequeo de salud. Cada tabla lista método, ruta, qué hace, quién puede llamarla y
qué recibe.

**Prefijo común:** todas las rutas cuelgan de `/api`.

---

## Convenciones

### Sesiones

Hay **dos tipos de token**, firmados con el mismo secreto pero **no intercambiables**:

| Tipo | Se obtiene en | Lo valida | Se guarda en |
|---|---|---|---|
| **Personal** | `POST /auth/login` | `middleware/auth.js` | `tallerms_token` |
| **Cliente** | `POST /portal/login`, `/portal/otp/verificar`, `/portal/registro/verificar` | `middleware/auth-cliente.js` | `tallerms_portal_token` |

El token de cliente lleva `tipo: 'cliente'` y no lleva `rol`: presentarlo en una ruta de
personal devuelve **403**, no 401 — la sesión es válida, la sección no le corresponde.
`POST /auth/login` es **unificado**: busca primero en el personal y después en los clientes
con acceso al portal, y responde con `tipo` para que el frontend sepa a dónde mandar a cada
quien.

### Roles y jerarquía

Los roles del personal son **`recepcion` < `tecnico` < `admin`** (`middleware/roles.js`).
Dos formas de exigirlos, que no significan lo mismo:

- **Por jerarquía** (`requireRol`): «Recepción o superior» incluye también a técnico y
  administración. Es lo que se indica con el sufijo **`+`** en las tablas.
- **Por pertenencia exacta** (`soloRoles`): se enumeran los roles y **no** hay herencia. Se
  usa cuando un rol intermedio no debe tener un permiso que sí tiene uno inferior — el caso
  real: el **técnico no gestiona la agenda**, pero la recepción, que está por debajo, sí.

**Casillas de cada rol (Equipo → Roles).** Encima de lo anterior, algunas rutas revisan
una casilla con `exigirPermiso('...')` (`middleware/permisos.js`). Un rol propio parte de
Mostrador (`recepcion`) o de Taller (`tecnico`) y solo puede **quitar** casillas de lo que
esa base ya permite; administración puede todo. Una casilla que no se elige en la base de
alguien no se revisa nunca, así que los roles de fábrica con sus casillas de siempre
funcionan igual que antes. Los permisos se leen de la base en cada petición, no del token.
Cuando falta, la respuesta es 403 con `codigo: 'sin_permiso'` y `permiso`. Las reglas están
en `utils/permisos.js` (`FIJAS`, `ajustables`, `permisosEfectivos`), y los roles se
administran en `GET|POST /api/admin/roles`, `PUT|DELETE /api/admin/roles/:id` y
`POST /api/admin/roles/:id/restablecer` (solo admin).

Aparte está **`contenido`**: quien solo administra el sitio web. No entra en la jerarquía
(no pasa ningún `requireRol`) y además `middleware/auth.js` le corta, por lista blanca,
todo lo que no sea `/api/web`, `/api/auth` y `/api/marca`. Qué puede hacer dentro del
sitio web lo deciden sus **permisos web**, que marca el admin (ver Sitio web, más abajo).

| Etiqueta en las tablas | Significa |
|---|---|
| **Público** | Sin sesión |
| **Cliente** | Token de portal |
| **Recepción+** | recepcion, tecnico o admin |
| **Técnico+** | tecnico o admin |
| **Admin** | solo admin |
| **Recepción/Admin** | exactamente esos dos (sin técnico) |
| **Web: _permiso_** | el admin, o cualquier empleado al que el admin le marcó ese permiso web (`catalogo`, `precios`, `promo`, `consultas`, `negocio`, `publicar`) |
| **Web** | el admin, o cualquiera con al menos un permiso web |

### Respuestas

Éxito: `{ data: ... }` · Error: `{ error: "mensaje" }`.

| Código | Cuándo |
|---|---|
| 200 / 201 | Todo bien |
| 204 | Sin cuerpo (`POST /metricas/web-vitals`) |
| 400 | Datos inválidos — **incluidos los que rechaza MySQL** (clave foránea inexistente, duplicado, texto muy largo, ENUM inválido). Se traducen en `utils/responder.js`, para que un formulario mal llenado no se reporte como caída del servidor |
| 401 | Sin token o vencido |
| 403 | Sesión válida sin permiso, o token del tipo equivocado |
| 404 | No existe **o no es tuyo** — en recursos ajenos se devuelve 404 y no 403 a propósito: un 403 confirmaría que el recurso existe |
| 409 | Conflicto (nombre o placa ya usados) |
| 429 | Límite de tasa |
| 500 | Falla real del servidor |

### Límites de tasa

| Grupo | Límite por IP |
|---|---|
| Autenticación (`/auth/login`, `/auth/2fa/*`, `/portal/login`, `/portal/registro`, `/portal/recuperar`, `/portal/otp`) | 30 cada 15 min |
| General (`/api/*`) | 600/min |
| Administración (`/api/admin/*`) | límite propio, más estricto |
| `/api/health` | exento (lo sondea la plataforma) |

Además, `POST /auth/login` limita **por correo** (10/min, 60/hora) para que el ataque de
fuerza bruta no se reparta entre muchas IPs.

### Imágenes

Fotos y logos se guardan como *data URL* en base64 dentro de la base. Por eso **nunca
viajan dentro de un listado**: la lista devuelve `tiene_foto` / `tiene_imagen` y la imagen
se pide por su propia ruta, que el cliente cachea. Aplica a promociones, mensajería y
avatares. Como esas rutas exigen sesión, no sirven en un `<img src>` directo: el frontend
las trae por HTTP y asigna la data URL cuando llega.

---

## Índice

| Módulo | Prefijo | Rutas |
|---|---|---|
| [Autenticación](#autenticación--apiauth) | `/api/auth` | 7 |
| [Marca del taller](#marca-del-taller--apimarca) | `/api/marca` | 3 |
| [Clientes](#clientes--apiclientes) | `/api/clientes` | 9 |
| [Motos](#motos--apimotos) | `/api/motos` | 5 |
| [Citas](#citas--apicitas) | `/api/citas` | 6 |
| [Órdenes de trabajo](#órdenes-de-trabajo--apiordenes) | `/api/ordenes` | 21 |
| [Garantías](#garantías--apigarantias) | `/api/garantias` | 6 |
| [Promociones](#promociones--apipromos) | `/api/promos` | 6 |
| [Empleados](#empleados--apiusuarios) | `/api/usuarios` | 7 |
| [Mensajería interna](#mensajería-interna--apimensajeria) | `/api/mensajeria` | 8 |
| [Recepción](#recepción--apirecepcion) | `/api/recepcion` | 38 |
| [Mecánico](#mecánico--apimecanico) | `/api/mecanico` | 18 |
| [Administración](#administración--apiadmin) | `/api/admin` | 22 |
| [Indicadores](#indicadores--apidashboard) | `/api/dashboard` | 4 |
| [Portal del cliente](#portal-del-cliente--apiportal) | `/api/portal` | 49 |
| [Métricas de experiencia](#métricas-de-experiencia--apimetricas) | `/api/metricas` | 2 |
| [Sitio web: administración](#sitio-web-administración--apiweb) | `/api/web` | 49 |
| [Sitio web: lo publicado](#sitio-web-lo-publicado--apisitio) | `/api/sitio` | 5 |
| [Estado del servicio](#estado-del-servicio) | `/api/health` | 1 |
| | **Total** | **265** |

---

## Autenticación · `/api/auth`

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| POST | `/auth/login` | Login unificado: personal y clientes del portal por el mismo formulario. Devuelve `tipo` ('staff' \| 'cliente') | Público | `email`, `password` |
| GET | `/auth/me` | Usuario de la sesión actual | Autenticado | — |
| POST | `/auth/2fa/verificar` | Canjea el token parcial del login por una sesión real | Público (token parcial) | `token_parcial`, `codigo` |
| GET | `/auth/2fa/estado` | Si la cuenta tiene verificación en dos pasos activa | Autenticado | — |
| POST | `/auth/2fa/setup` | Paso 1: genera la clave y el QR. Queda guardada pero **inactiva** | Autenticado | — |
| POST | `/auth/2fa/activar` | Paso 2: confirma con un código y activa. Devuelve los códigos de respaldo — única vez que se ven en claro | Autenticado | `codigo` |
| POST | `/auth/2fa/desactivar` | Da de baja el segundo factor | Autenticado | `password`¹ |

¹ Se exige la contraseña otra vez: debilita la cuenta, y no debería alcanzar con tener la
sesión abierta en un equipo prestado.

Con 2FA activo, `POST /auth/login` **no** devuelve sesión: responde
`{ requiere_2fa: true, token_parcial }`, que solo sirve para `/auth/2fa/verificar`.

## Marca del taller · `/api/marca`

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/marca/logo` | Imagen del taller | Público² | — |
| GET | `/marca/portal` | Textos del portal que escribió el taller: `bienvenida` { titulo, texto }, `condiciones` [{ titulo, texto }] y `condiciones_actualizado`. Vacío = los de fábrica | Público | — |
| GET | `/marca` | Datos del taller para encabezar documentos (factura, correos) | Autenticado | — |

² Público a propósito: lo pide el cliente de correo de quien recibe la notificación, que no
manda cabeceras de sesión.

## Clientes · `/api/clientes`

Todo el módulo exige **Recepción/Admin** (pertenencia exacta: el técnico no entra).

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/clientes` | Directorio con búsqueda | Recepción/Admin | `?q` |
| POST | `/clientes` | Alta de cliente | Recepción/Admin | `nombre`, `apellido`, `telefono`, `email`, `cedula`, `direccion` |
| GET | `/clientes/:id` | Ficha del cliente | Recepción/Admin | — |
| PUT | `/clientes/:id` | Edita sus datos | Recepción/Admin | `nombre`, `apellido`, `telefono`, `email`, `cedula`, `direccion` |
| GET | `/clientes/:id/motos` | Sus motos | Recepción/Admin | — |
| GET | `/clientes/:id/ordenes` | Su historial de órdenes | Recepción/Admin | — |
| PATCH | `/clientes/:id/cortesia` | Canjea la cortesía de fidelización y la registra en el historial | Recepción/Admin | `orden_id`, `descripcion` (opcionales) |
| PATCH | `/clientes/:id/portal` | Activa/desactiva el acceso al portal y fija su contraseña | Admin³ | `password`, `activar` |
| DELETE | `/clientes/:id` | Baja del cliente **conservando el historial** del taller | Recepción/Admin | — |

³ Fija contraseñas de acceso: es la operación más sensible del módulo y se restringe a
administración.

## Motos · `/api/motos`

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/motos` | Lista con filtros | Autenticado | `?q`, `?cliente_id` |
| POST | `/motos` | Registra una moto | Autenticado | `cliente_id`, `marca`, `modelo`, `anio`, `placa`, `color`, `numero_motor`, `numero_chasis`, `kilometraje_actual`, `foto_url` |
| GET | `/motos/:id` | Detalle | Autenticado | — |
| PUT | `/motos/:id` | Edita la moto | Autenticado | mismos campos, sin `cliente_id` |
| GET | `/motos/:id/historial` | Servicios hechos a esa moto | Autenticado | — |

La **placa es única a nivel de base**, no solo en la aplicación: hay una columna generada
que la normaliza (sin espacios ni guiones, en mayúsculas) con índice único encima.

## Citas · `/api/citas`

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/citas` | Lista con filtros | Recepción+ | `?fecha`, `?estado`, `?tecnico_id`, `?sucursal_id`, `?q` |
| POST | `/citas` | Agenda una cita | Recepción/Admin⁴ | `cliente_id`, `moto_id`, `fecha`, `hora`, `tipo_servicio`, `tecnico_id` |
| GET | `/citas/:id` | Detalle | Recepción+ | — |
| PUT | `/citas/:id` | Reprograma o edita | Recepción/Admin⁴ | mismos campos |
| PATCH | `/citas/:id/estado` | Avanza el estado | Recepción+ | `estado` |
| PATCH | `/citas/:id/asignar` | Asigna la cita a un mecánico | Admin | `tecnico_id` |

⁴ Pertenencia exacta: **el técnico no gestiona la agenda**, aunque esté por encima de
recepción en la jerarquía. Es el ejemplo que motiva la existencia de `soloRoles`.

**Estados:** `agendado` → `en_revision` → `en_mantenimiento` → `listo` → `entregado`
(o `cancelado`). El control de cupo por fecha/hora toma un bloqueo de rango, así que dos
personas no pueden llevarse el último lugar a la vez.

## Órdenes de trabajo · `/api/ordenes`

La OT es la entidad central del sistema. Todo el módulo exige **Recepción+** salvo lo
indicado.

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/ordenes` | Lista con filtros | Recepción+ | `?estado`, `?tecnico_id`, `?fecha_desde`, `?fecha_hasta` |
| POST | `/ordenes` | Abre una orden | Recepción+ | `moto_id`, `cliente_id`, `problema_reportado`, `kilometraje_ingreso`, `nivel_combustible`, `accesorios_entregados`, `estado_fisico`, `prioridad`, `categoria`, `fecha_estimada_entrega` |
| GET | `/ordenes/:id` | Detalle completo | Recepción+ | — |
| PUT | `/ordenes/:id` | Diagnóstico y costos | Técnico+⁵ | `diagnostico`, `tiempo_estimado_horas`, `costo_mano_obra`, `costo_repuestos`, `descuento`, `fecha_estimada_entrega`, `prioridad`, `categoria`, `accesorios_entregados`, `estado_fisico` |
| PATCH | `/ordenes/:id/estado` | Avanza la máquina de estados | Recepción+ | `estado` |
| PATCH | `/ordenes/:id/tecnico` | Asigna mecánico | Admin | `tecnico_id` |
| GET | `/ordenes/:id/avances` | Avances registrados | Recepción+ | — |
| POST | `/ordenes/:id/avances` | Registra un avance | Recepción+ | `descripcion` |
| GET | `/ordenes/:id/repuestos` | Repuestos de la orden | Recepción+ | — |
| POST | `/ordenes/:id/repuestos` | Agrega un repuesto | Recepción+ | `nombre`, `cantidad`, `costo_unitario`, `estado` |
| PUT | `/ordenes/:id/repuestos/:rid` | Edita un repuesto | Recepción+ | mismos campos |
| DELETE | `/ordenes/:id/repuestos/:rid` | Elimina un repuesto | Admin | — |
| GET | `/ordenes/:id/tiempos` | Línea de tiempo: cuánto duró cada etapa | Recepción+ | — |
| GET | `/ordenes/:id/checklist` | Checklist de entrega | Recepción+ | — |
| POST | `/ordenes/:id/checklist` | Guarda el checklist | Recepción+ | `prueba_realizada`, `lavado`, `calidad_revisada`, `facturacion_lista`, `cliente_notificado`, `observaciones` |
| PATCH | `/ordenes/:id/cerrar` | Cierre + facturación + fidelización | Admin | `metodo_pago`, `garantia_dias`, `observaciones_finales` |
| GET | `/ordenes/:id/fotos` | Evidencia fotográfica | Recepción+ | — |
| POST | `/ordenes/:id/fotos` | Sube una foto (data URL) | Recepción+ | `url`, `tipo`, `descripcion` |
| DELETE | `/ordenes/:id/fotos/:fid` | Borra una foto | Admin | — |
| GET | `/ordenes/:id/mensajes` | Hilo de la orden (marca leídos los míos) | Recepción+ | — |
| POST | `/ordenes/:id/mensajes` | Mensaje sobre la orden: mecánico → recepción, recepción/admin → mecánico asignado | Recepción+ | `mensaje`, `foto` |

⁵ Toca plata (mano de obra, repuestos, descuento), así que **recepción no edita montos**.

**Estados:** `recepcion` → `diagnostico` → `esperando_aprobacion` → `esperando_repuestos` →
`en_reparacion` → `lista_entrega` → `entregada`, o `cancelada` (solo administración). Los
saltos y retrocesos ilógicos están bloqueados y cubiertos por tests. Cada transición queda
registrada en `orden_tiempos`, que es lo que alimenta el informe de duración por etapa. El
número (`OT-YYYY-XXXX`) se asigna solo.

## Garantías · `/api/garantias`

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/garantias` | Reclamos con filtros | Recepción+ | `?estado`, `?orden_id` |
| GET | `/garantias/:id` | Un reclamo con sus fotos | Recepción+ | — |
| POST | `/garantias` | Registra un reclamo | Recepción+ | `orden_id`, `descripcion_problema`, `cubre_repuestos`, `cubre_mano_obra` |
| PATCH | `/garantias/:id/estado` | Avanza el trámite y resuelve | Admin | `estado`, `resolucion`, `cubre_repuestos`, `cubre_mano_obra` |
| POST | `/garantias/:id/fotos` | Evidencia del reclamo | Recepción+ | `url`, `descripcion` |
| DELETE | `/garantias/:id/fotos/:fid` | Borra una foto | Recepción+ | — |

**Estados:** `abierto` → `en_revision` → `aprobado` / `rechazado` → `resuelto`.

## Promociones · `/api/promos`

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/promos` | Todas, para gestión — **sin la imagen**⁶ | Autenticado | — |
| GET | `/promos/:id/imagen` | La imagen de una promoción | Autenticado | — |
| POST | `/promos` | Crea una promoción | Admin | `titulo`, `descripcion`, `descuento`, `activa`, `imagen`, `precio_final` |
| PUT | `/promos/:id` | Edita (incluye imagen) | Admin | mismos campos |
| PATCH | `/promos/:id/toggle` | Activa/desactiva | Admin | — |
| DELETE | `/promos/:id` | Elimina | Admin | — |

⁶ El listado devuelve `tiene_imagen`. Cuando la imagen viajaba adentro, cada carga del
panel movía **3 MB**; separarla lo dejó en 5,6 KB (hallazgo 2 del informe de pruebas).

## Empleados · `/api/usuarios`

Todo el módulo es **Admin**.

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/usuarios` | Lista del personal (con `permisos_web`) | Admin | — |
| GET | `/usuarios/permisos-web` | Las casillas de permisos web que se pueden dar | Admin | — |
| POST | `/usuarios` | Alta de empleado | Admin | `nombre`, `email`, `password`, `rol` (incluye `contenido`), `telefono`, `permisos_web` |
| PUT | `/usuarios/:id` | Edita sus datos | Admin | `nombre`, `email`, `rol`, `telefono`, `permisos_web` (opcional: si no viene, se conservan) |
| PATCH | `/usuarios/:id/activo` | Activa/desactiva sin borrar | Admin | `activo` |
| PATCH | `/usuarios/:id/sucursal` | Cambia de local (`null` = ambas) | Admin | `sucursal_id` |
| DELETE | `/usuarios/:id` | Elimina definitivamente⁷ | Admin | — |

⁷ `usuarios` está referenciada por 10 claves foráneas, así que un DELETE pelado fallaría:
la baja se resuelve en una transacción que limpia o reasigna cada referencia.

## Mensajería interna · `/api/mensajeria`

Chat 1:1 entre el personal, más avisos por megáfono. Todo el módulo exige **Recepción+**.

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/mensajeria/contactos` | Lista estilo WhatsApp: personal activo con el último mensaje y los no leídos por conversación | Recepción+ | — |
| GET | `/mensajeria/conversacion/:usuarioId` | Hilo privado (últimos 200)⁸ | Recepción+ | — |
| POST | `/mensajeria/conversacion/:usuarioId` | Envía un mensaje directo | Recepción+ | `mensaje`, `foto` |
| GET | `/mensajeria/no-leidos` | Total global para el indicador del menú | Recepción+ | — |
| GET | `/mensajeria/avisos` | Feed de avisos a todo el personal | Recepción+ | — |
| POST | `/mensajeria/avisos` | Publica un aviso para los mecánicos | Recepción/Admin | `mensaje`, `foto` |
| GET | `/mensajeria/mensaje/:id/foto` | Imagen de un mensaje⁹ | Recepción+ | — |
| GET | `/mensajeria/contacto/:id/foto` | Avatar de un compañero | Recepción+ | — |

⁸ La privacidad la impone el `WHERE`: el id propio va en ambos lados del par, así que es
imposible leer un hilo del que no se es parte, sin importar qué id se mande.

⁹ Los ids de mensaje son correlativos: sin comprobar pertenencia al par, cualquiera del
personal podría recorrerlos y leer fotos ajenas. Cuando no corresponde devuelve **404 y no
403**, porque un 403 confirmaría que ese mensaje existe.

## Recepción · `/api/recepcion`

El mostrador. Todo el módulo exige **Recepción+** salvo lo indicado.

### Panel del día

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/recepcion/resumen` | Resumen del día | Recepción+ | — |
| GET | `/recepcion/citas-hoy` | Citas de hoy | Recepción+ | — |
| GET | `/recepcion/agenda` | Citas en un rango (calendario mensual) | Recepción+ | `?desde`, `?hasta` |
| GET | `/recepcion/alertas` | Eventos del taller que hay que atender | Recepción+ | — |
| GET | `/recepcion/avances` | Avances recientes cargados por los mecánicos | Recepción+ | — |
| GET | `/recepcion/disponibilidad` | Horas libres de una fecha (mismo cupo que ve el cliente) | Recepción+ | `?fecha`, `?sucursal_id` |

### Recepción del cliente

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| PATCH | `/recepcion/citas/:id/llegada` | Check-in de mostrador (idempotente) | Recepción+ | — |
| DELETE | `/recepcion/citas/:id/llegada` | Deshace la llegada marcada por error | Recepción+ | — |
| POST | `/recepcion/citas/:id/crear-orden` | Crea (o recupera) la orden de esa cita | Recepción+ | — |

### Órdenes y evidencia

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/recepcion/ordenes` | Órdenes activas o completadas | Recepción+ | `?estado` |
| GET | `/recepcion/ordenes/:id/fotos` | Fotos de una orden | Recepción+ | — |
| POST | `/recepcion/ordenes/:id/fotos` | Sube evidencia (data URL) | Recepción+ | `url`, `tipo`, `descripcion` |
| PATCH | `/recepcion/ordenes/:id/tecnico` | Asigna mecánico a la orden | Recepción+ | `tecnico_id` |
| POST | `/recepcion/ordenes/:id/entregar` | Entrega: registra pago y garantía, y cierra¹⁰ | Recepción+ | `metodo_pago`, `garantia_dias`, `observaciones_finales` |

¹⁰ Reusa la misma lógica transaccional del cierre (fidelización + sincronización de la
cita), pero recepción solo puede entregar órdenes que ya estén listas para entrega.

### Cotizaciones

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/recepcion/cotizaciones` | Órdenes con costos, pendientes o enviadas | Recepción+ | `?estado` |
| GET | `/recepcion/cotizaciones/:id/repuestos` | Piezas de la cotización | Recepción+ | — |
| POST | `/recepcion/cotizaciones/:id/repuestos` | Agrega una pieza | Recepción+ | `nombre`, `cantidad`, `costo_unitario`, `estado` |
| PUT | `/recepcion/cotizaciones/:id/repuestos/:rid` | Edita una pieza | Recepción+ | mismos campos |
| DELETE | `/recepcion/cotizaciones/:id/repuestos/:rid` | Quita una pieza | Recepción+ | — |
| PUT | `/recepcion/cotizaciones/:id/costos` | Mano de obra y descuento | Recepción+ | `costo_mano_obra`, `descuento` |
| POST | `/recepcion/cotizaciones/:id/armar` | Arma la cotización completa en **una transacción**¹¹ | Recepción+ | `tecnico_id`, `piezas[]`, `costo_mano_obra`, `descuento` |
| POST | `/recepcion/cotizaciones/:id/enviar` | La orden pasa a esperando aprobación | Recepción+ | — |
| POST | `/recepcion/cotizaciones/:id/aprobar` | Aprobación verbal en el mostrador | Recepción/Admin¹² | — |
| GET | `/recepcion/clientes/:id/ordenes` | Órdenes activas de un cliente | Recepción+ | — |

¹¹ Asigna técnico, inserta todas las piezas, fija mano de obra y descuento y recalcula el
total de una sola vez: si algo falla, no queda una cotización a medias.

¹² No es una acción que un técnico deba poder forjar en nombre del cliente.

### Directorio y catálogos

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/recepcion/clientes` | Directorio con búsqueda | Recepción+ | `?q` |
| GET | `/recepcion/tecnicos` | Mecánicos activos¹³ | Recepción+ | `?sucursal_id` |
| GET | `/recepcion/servicios` | Catálogo de servicios activos | Recepción+ | — |
| GET | `/recepcion/sucursales` | Locales activos | Recepción+ | — |

¹³ Recepción no puede usar `/api/usuarios`, que es solo de administración. Con
`?sucursal_id` devuelve los de esa sede más los de «ambas».

### Avisos al cliente

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/recepcion/notificaciones` | Notificaciones enviadas (feed de salida) | Recepción+ | — |
| POST | `/recepcion/notificar` | Envía una notificación manual | Recepción+ | `cliente_id`, `cita_id`, `titulo`, `mensaje` |

### Mensajería de oficina

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/recepcion/mensajes-internos` | Bandeja de la oficina, separada por rol¹⁴ | Recepción+ | — |
| GET | `/recepcion/mensajes-internos/no-leidos` | Contador para el indicador | Recepción+ | — |
| POST | `/recepcion/mensajes-internos` | Responde a un mecánico | Recepción+ | `destino_id`, `mensaje`, `foto`, `orden_id` |
| POST | `/recepcion/mensajes-internos/broadcast` | Aviso a todos los mecánicos | Recepción+ | `mensaje`, `foto` |

¹⁴ Administración ve su propio bolsón; recepción ve el suyo, filtrado por sucursal.

### Perfil

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/recepcion/perfil` | Mi perfil | Recepción+ | — |
| PUT | `/recepcion/perfil` | Edita mis datos | Recepción+ | `nombre`, `email`, `telefono` |
| PUT | `/recepcion/perfil/foto` | Cambia o quita mi foto | Recepción+ | `foto` (data URL o `null`) |
| PUT | `/recepcion/perfil/password` | Cambia mi contraseña | Recepción+ | `actual`, `nueva` |

## Mecánico · `/api/mecanico`

El taller. Todo el módulo exige **Técnico+**, y las consultas se acotan solas al mecánico
de la sesión: no hace falta —ni se acepta— mandar el id propio.

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/mecanico/resumen` | Mis indicadores | Técnico+ | — |
| GET | `/mecanico/citas` | Mis citas asignadas | Técnico+ | `?fecha`, `?estado` |
| GET | `/mecanico/agenda` | Mis citas en un rango (semana) | Técnico+ | `?desde`, `?hasta` |
| PATCH | `/mecanico/citas/:id/estado` | Avanza **mi** cita, con monto opcional | Técnico+ | `estado`, `monto` |
| POST | `/mecanico/ordenes/:id/repuestos` | Solicita repuestos (el precio lo pone recepción) | Técnico+ | `nombre`, `cantidad` |
| GET | `/mecanico/alertas` | Mensajes sin leer, citas nuevas y cambios en órdenes | Técnico+ | — |
| GET | `/mecanico/tareas` | Mis pendientes | Técnico+ | — |
| POST | `/mecanico/tareas` | Crea una tarea propia | Técnico+ | `titulo`, `detalle`, `prioridad` |
| PATCH | `/mecanico/tareas/:id` | Marca hecha (alterna si no se indica) | Técnico+ | `hecha` |
| DELETE | `/mecanico/tareas/:id` | Borra una tarea propia | Técnico+ | — |
| GET | `/mecanico/mensajes` | Mi bandeja | Técnico+ | — |
| GET | `/mecanico/mensajes/no-leidos` | Contador | Técnico+ | — |
| POST | `/mecanico/mensajes` | Escribe a la oficina | Técnico+ | `mensaje`, `foto`, `orden_id`, `destino` |
| GET | `/mecanico/recepcion-contacto` | A quién escribirle en el mostrador | Técnico+ | — |
| GET | `/mecanico/perfil` | Mi perfil, estadísticas y calificaciones | Técnico+ | — |
| PATCH | `/mecanico/perfil` | Edito lo mío | Técnico+ | `telefono`, `especialidades`, `horario` |
| PUT | `/mecanico/perfil/foto` | Cambio mi foto | Técnico+ | `foto` |
| PUT | `/mecanico/perfil/password` | Cambio mi contraseña | Técnico+ | `actual`, `nueva` |

## Administración · `/api/admin`

Todo el módulo es **Admin** y tiene su propio límite de tasa, más estricto.

### Analítica

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/admin/resumen` | Indicadores del mes, distribución de citas e ingresos por servicio | Admin | — |
| GET | `/admin/reportes` | Analítica por período: serie temporal, ingresos, rendimiento por mecánico y cotizaciones por recepción | Admin | `?periodo=mes\|mes_pasado\|anio`, `?empleado` |
| GET | `/admin/opiniones` | Calificaciones reales del cliente¹⁵ | Admin | `?estrellas`, `?empleado`, `?limit` |
| GET | `/admin/calendario` | Citas del mes agrupadas por día y mecánico | Admin | `?mes`, `?anio` |

¹⁵ Une citas y órdenes sin doble conteo: una orden ligada a una cita cuenta una sola vez,
el mismo criterio con que se calculan los ingresos.

### Tareas asignadas

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/admin/tareas` | Tareas asignadas, para seguimiento | Admin | `?empleado` |
| POST | `/admin/tareas` | Asigna una tarea a un mecánico | Admin | `tecnico_id`, `titulo`, `detalle`, `prioridad`, `vence` |
| PUT | `/admin/tareas/:id` | Corrige una tarea ya asignada¹⁶ | Admin | mismos campos |
| DELETE | `/admin/tareas/:id` | Cancela una tarea asignada | Admin | — |

¹⁶ El estado `hecha` no se toca desde acá a propósito: lo marca quien hace el trabajo.

### Catálogo de servicios

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/admin/servicios` | Catálogo completo, incluidos los desactivados | Admin | — |
| POST | `/admin/servicios` | Agrega un servicio | Admin | `nombre` |
| PUT | `/admin/servicios/:id` | Renombra | Admin | `nombre` |
| PATCH | `/admin/servicios/:id/activo` | Activa/desactiva sin borrar | Admin | `activo` |
| DELETE | `/admin/servicios/:id` | Elimina, **solo si nunca se usó**¹⁷ | Admin | — |

¹⁷ Si ya hay citas con ese servicio se rechaza y se sugiere desactivarlo: borrarlo dejaría
en los reportes un servicio que ya no se puede volver a ofrecer.

### Configuración y sucursales

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/admin/configuracion` | Datos del taller, horarios, cupos y notificaciones | Admin | — |
| PUT | `/admin/configuracion` | Los guarda | Admin | datos del taller, `horarios[]` (día, abre, cierra, activo), cupos, anticipación, `logo`, formas de pago, garantía, `razon_social`, `cedula_juridica`, `nota_factura`, `pass_min_largo`, `pass_variedad`, `portal_textos` (aviso del inicio del portal y condiciones del servicio; la fecha de las condiciones se pone sola; si no viene, no se toca), `plantillas` (mensajes al cliente reescritos: `{ whatsapp: {clave: texto}, correo: {listo|entregado: {titulo, mensaje}} }`; si no viene, no se toca) |
| GET | `/admin/feriados` | Feriados que se repiten, con su próxima fecha y las citas de ese día; y los de ley con fecha fija que faltan (`sugeridos`) | Admin | — |
| POST | `/admin/feriados` | Marca uno o varios: la agenda los bloquea enteros todos los años. No duplica | Admin | `mes`, `dia`, `nombre`, `sucursal_id?` o `lista[]` |
| DELETE | `/admin/feriados/:id` | Deja de bloquearse | Admin | — |
| GET | `/admin/correo` | Remitente de los correos (`MAIL_FROM`) y si su dominio está verificado en Resend. Nunca devuelve la clave | Admin | — |
| POST | `/admin/correo/prueba` | Correo de prueba al usuario que lo pide; uno por minuto (429) | Admin | — |
| GET | `/admin/respaldos` | Estado de los respaldos (`al_dia`, `atrasado`, `fallo`, `sin_configurar`, `sin_datos`), copias guardadas e historial. Nunca devuelve llaves ni la frase | Admin | — |
| POST | `/admin/respaldos` | Respalda ya; uno cada 10 minutos (429), 409 si hay otro en curso o no está configurado | Admin | — |
| GET | `/admin/seguridad` | El personal con verificación en dos pasos, último ingreso y cuándo se le cerraron las sesiones; y la política de contraseñas | Admin | — |
| POST | `/admin/seguridad/cerrar` | Cierra las sesiones de alguien (o de todos menos uno mismo): sus tokens dejan de valer y responden 401 `sesion_cerrada` | Admin | `usuario_id` o `todos: true` |
| GET | `/admin/sucursales` | Locales | Admin | — |
| POST | `/admin/sucursales` | Alta de local | Admin | `nombre`, `direccion`, `telefono` |
| PUT | `/admin/sucursales/:id` | Edita el local | Admin | `nombre`, `direccion`, `telefono` |
| PATCH | `/admin/sucursales/:id/activa` | Activa/desactiva¹⁸ | Admin | `activa` |

¹⁸ No permite dejar el taller con cero sucursales activas.

### Cuenta propia

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| PUT | `/admin/cuenta` | Mis datos | Admin | `nombre`, `email` |
| PUT | `/admin/cuenta/password` | Mi contraseña, verificando la actual | Admin | `actual`, `nueva` |
| PUT | `/admin/cuenta/foto` | Mi foto | Admin | `foto` |

## Indicadores · `/api/dashboard`

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/dashboard/resumen` | Indicadores operativos | Admin | — |
| GET | `/dashboard/atrasos` | Órdenes activas con semáforo de entrega | Admin | — |
| GET | `/dashboard/tecnicos` | Carga y rendimiento por mecánico | Admin | — |
| GET | `/dashboard/tiempos` | Duración promedio por etapa de la orden | Admin | — |

## Portal del cliente · `/api/portal`

Sesión propia (token de cliente). Las rutas de acceso son públicas; **todo lo demás exige
sesión de cliente y se acota solo a sus propios datos** — el id del cliente sale del token,
nunca de la petición.

### Acceso y registro (público)

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| POST | `/portal/login` | Entra con correo y contraseña | Público | `email`, `password` |
| POST | `/portal/registro` | Auto-registro. **No abre sesión**: manda un código al correo¹⁹ | Público | `nombre`, `apellido`, `telefono`, `email`, `cedula`, `password` |
| POST | `/portal/registro/verificar` | Confirma el código y recién ahí otorga sesión | Público | `email`, `codigo` |
| POST | `/portal/registro/reenviar` | Otro código (no llegó o venció) | Público | `email` |
| POST | `/portal/recuperar/solicitar` | Código para restablecer la contraseña | Público | `email` |
| POST | `/portal/recuperar/confirmar` | Valida el código y fija la nueva | Público | `email`, `codigo`, `password` |
| POST | `/portal/otp/solicitar` | Código de acceso sin contraseña | Público | `email` |
| POST | `/portal/otp/verificar` | Entra con ese código | Público | `email`, `codigo` |

¹⁹ Registro, reenvío, recuperación y OTP van con **honeypot + captcha** y responden en
forma genérica, para no revelar qué correos existen.

### Inicio y notificaciones

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/portal/resumen` | Panel de inicio del cliente | Cliente | — |
| GET | `/portal/notificaciones` | Feed de avances²⁰ | Cliente | — |
| GET | `/portal/notificaciones/contador` | Solo el número de no leídas | Cliente | — |
| POST | `/portal/notificaciones/leer` | Marca todas como leídas | Cliente | — |
| PATCH | `/portal/notificaciones/:id/leer` | Marca una | Cliente | — |
| DELETE | `/portal/notificaciones/leidas` | Limpia las leídas | Cliente | — |
| DELETE | `/portal/notificaciones/:id` | Borra una (deslizar para eliminar) | Cliente | — |

²⁰ Al consultarlo purga las leídas hace más de unos días: la información real vive en el
detalle de la cita, el feed no debe crecer para siempre.

### Cuenta

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/portal/perfil` | Mis datos | Cliente | — |
| PUT | `/portal/perfil` | Edita contacto²¹ | Cliente | `nombre`, `apellido`, `telefono`, `email` |
| POST | `/portal/perfil/email/confirmar` | Aplica el cambio de correo pendiente | Cliente | `codigo` |
| POST | `/portal/perfil/email/reenviar` | Otro código a la dirección pendiente | Cliente | — |
| DELETE | `/portal/perfil/email` | Descarta el cambio pendiente²² | Cliente | — |
| PUT | `/portal/perfil/notificaciones` | Preferencias de aviso | Cliente | `notif_avances`, `notif_recordatorios` |
| PUT | `/portal/perfil/password` | Cambia la contraseña verificando la actual | Cliente | `actual`, `nueva` |
| PUT | `/portal/perfil/foto` | Sube, cambia o quita la foto²³ | Cliente | `foto` (data URL o `null`) |
| DELETE | `/portal/perfil` | Da de baja su cuenta²⁴ | Cliente | — |

²¹ Cambiar el correo no es inmediato: queda pendiente hasta confirmarlo con un código
enviado a la dirección nueva.
²² Por si se escribió mal, o si el dueño real de esa casilla recibió el aviso y quiere
frenarlo.
²³ Va aparte de los datos de contacto para no reenviar la imagen cada vez que se corrige un
teléfono.
²⁴ Baja lógica: no se borran órdenes ni citas —el taller necesita su historial—, se
desactiva el acceso al portal.

### Citas

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/portal/citas` | Mis citas | Cliente | — |
| GET | `/portal/citas/:id` | Detalle de una cita propia | Cliente | — |
| POST | `/portal/citas` | Solicita una cita (entra **pendiente** de confirmar) | Cliente | `moto_id`, `fecha`, `hora`, `tipo_servicio`, `descripcion` |
| PUT | `/portal/citas/:id` | Reprograma²⁵ | Cliente | mismos campos |
| PATCH | `/portal/citas/:id/cancelar` | Cancela y libera el cupo²⁵ | Cliente | — |
| PATCH | `/portal/citas/:id/confirmar` | Confirma que asistirá | Cliente | — |
| POST | `/portal/citas/:id/calificar` | Puntúa una cita ya entregada (1-5) | Cliente | `calificacion` |
| GET | `/portal/disponibilidad` | Horas con cupo ese día²⁶ | Cliente | `?fecha`, `?sucursal_id` |
| GET | `/portal/proximo-libre` | Primer horario disponible | Cliente | — |
| GET | `/portal/servicios` | Qué puede elegir al agendar²⁷ | Cliente | — |
| GET | `/portal/sucursales` | Locales para el selector | Cliente | — |

²⁵ Solo mientras la cita está `agendado`, sin orden iniciada y respetando la ventana mínima
de anticipación. Después la gestiona el taller.
²⁶ El horario es compartido, pero **el cupo se cuenta por sucursal**: una cita en un local
no ocupa lugar en el otro.
²⁷ Se sirve desde la base para que coincida siempre con lo que valida `POST /portal/citas`.
Antes el catálogo estaba duplicado en el frontend y se desincronizaba.

### Motos

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/portal/motos` | Mis motos | Cliente | — |
| POST | `/portal/motos` | Registra una moto propia | Cliente | `marca`, `modelo`, `placa` (obligatorios), `anio`, `color`, `kilometraje_actual`, `foto` |
| PUT | `/portal/motos/:id` | Edita una moto propia | Cliente | mismos campos |
| DELETE | `/portal/motos/:id` | Da de baja una moto (lógica) | Cliente | — |
| GET | `/portal/motos/:id/historial` | Línea de tiempo de servicios²⁸ | Cliente | — |

²⁸ No filtra por moto activa: el historial sobrevive a la baja de la moto.

### Órdenes y presupuestos

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/portal/ordenes` | Mis órdenes | Cliente | — |
| GET | `/portal/ordenes/:id` | Detalle de una orden propia | Cliente | — |
| POST | `/portal/ordenes/:id/aprobar` | **Aprueba el presupuesto** | Cliente | — |
| POST | `/portal/ordenes/:id/rechazar` | Lo rechaza | Cliente | `motivo` |
| POST | `/portal/ordenes/:id/encuesta` | Encuesta de satisfacción tras la entrega | Cliente | `calificacion` (1-5) |

### Fidelización y promociones

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/portal/fidelidad` | Progreso hacia la próxima cortesía²⁹ | Cliente | — |
| GET | `/portal/recompensas` | Historial de cortesías canjeadas | Cliente | — |
| GET | `/portal/promos` | Promociones activas, **sin la imagen** | Cliente | — |
| GET | `/portal/promos/:id/imagen` | La imagen de una promoción | Cliente | — |

²⁹ Se cuenta sobre citas entregadas, la misma fuente que usa `/portal/resumen`, para que
las dos pantallas nunca muestren números distintos.

## Métricas de experiencia · `/api/metricas`

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| POST | `/metricas/web-vitals` | Registra una métrica medida en el navegador. Responde **204**³⁰ | Público³¹ | `metrica` (LCP\|CLS\|INP\|FCP\|TTFB), `valor`, `calificacion`, `ruta`, `movil` |
| GET | `/metricas/web-vitals` | Percentil 75 por métrica, contra el umbral de Google | Admin | `?dias` (1-365, por defecto 30) |

³⁰ El navegador lo manda con `sendBeacon` al ocultarse la pestaña y no espera cuerpo.
³¹ Público a propósito: las métricas más valiosas son las de login y registro, que ocurren
antes de que exista un token. A cambio se valida con dureza —solo los cinco nombres
conocidos, valor entre 0 y 600 000, ruta sin querystring— y queda dentro del límite general
de `/api`. No se guarda ningún identificador de la persona.

## Sitio web: administración · `/api/web`

El contenido del sitio web (msmotors-web) se edita aquí y **no llega al público hasta que
alguien publica**: `POST /web/publicar` guarda una foto completa del contenido en
`web_publicaciones`, que es lo único que lee el sitio al construirse. Los permisos se releen
de la base en cada petición (`utils/permisos-web.js`): si el admin le quita uno a alguien,
deja de valer en ese momento, sin esperar a que cierre sesión.

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/web/resumen` | Mis permisos, categorías, sucursales, **cambios pendientes de publicar**, última publicación, si hay hosting conectado | Web | — |
| GET | `/web/motos` | Catálogo completo (también las ocultas) | Web | — |
| POST | `/web/motos` | Agrega una moto³² | Web: catalogo | `nombre`, `tipo`, `estado`, `precio`, `moneda`, `resumen`, `descripcion`, `fotos` (lista), `foto_alt`, `specs` (`[{clave, valor}]`), `stock` (`{sucursal_id: n}`), `ingreso`, `visible`, `destacada` |
| PUT | `/web/motos/:id` | Edita una moto³² ³³ | Web: catalogo | igual que el alta |
| PUT | `/web/motos-orden` | Nuevo orden del catálogo | Web: catalogo | `ids` (en el orden nuevo) |
| DELETE | `/web/motos/:id` | Elimina una moto | Web: catalogo | — |
| GET | `/web/promos` | Las promociones emergentes del inicio, en orden de prioridad, y en `del_sitio` la de ejemplo con que se armó el sitio (siempre apagada) | Web | — |
| PUT | `/web/promos` | Guarda la lista entera, en orden (hasta 12). El sitio muestra una a la vez: la primera encendida cuyas fechas incluyen el día; dos con el mismo título reciben ids distintos | Web: promo | `promos` (`[{activa, titulo, destacado, comoParticipar, letraChica, imagen, imagenAlt, desde, hasta, verCada, cta}]`) |
| POST | `/web/publicar` | Publica: guarda la foto del contenido y avisa al hosting³⁴ | Web: publicar | — |
| GET | `/web/historial` | Quién cambió qué (últimos 50; hasta 200) | Admin | `?limite` |
| POST | `/web/fotos` | Sube una foto (ya achicada por el panel); devuelve su ruta `/api/sitio/fotos/<clave>.<ext>`³⁶ | Web: catalogo o promo | `foto` (data URL JPG/PNG/WebP), `ancho`, `alto` |
| POST | `/web/motos/:id/duplicar` | Copia una moto (sale oculta, sin unidades; sin precio si no tiene permiso de precios) | Web: catalogo | — |
| GET | `/web/motos/plantilla` | Baja la plantilla CSV para cargar el catálogo, con los títulos y una columna por sede | Web: catalogo | — |
| POST | `/web/motos/importar` | Revisa un CSV y dice línea por línea qué entra y qué no; con `confirmar` crea las motos buenas⁴⁵ | Web: catalogo | `csv`, `confirmar` (opcional) |
| POST | `/web/motos/traer-del-sitio` | Trae al panel las motos que el sitio muestra hoy (las de ejemplo con que se armó), visibles y con sus fotos⁵⁰ | Web: catalogo | — |
| GET | `/web/consultas` | Bandeja de consultas que llegan del sitio (últimas 300) | Web: consultas | `?estado` (nueva|atendida|descartada|hoy|mias) |
| PATCH | `/web/consultas/:id` | Cambia estado, nota, a quién está asignada y cuándo volver a contactar | Web: consultas | `estado`, `notas`, `asignada_a` (id o null), `seguimiento` (AAAA-MM-DD o null) |
| GET | `/web/equipo` | Quiénes pueden atender consultas (admin y quien tenga el permiso), para asignar | Web: consultas | — |
| POST | `/web/consultas/:id/cliente` | Da de alta al cliente en el sistema desde la consulta (como recepción); si ya existe por cédula o teléfono, lo vincula³⁸ | Web: consultas | `nombre`, `apellido`, `telefono`, `cedula`, `email` |
| GET | `/web/respuestas` | Respuestas rápidas de WhatsApp (`{nombre}`, `{moto}`, `{sede}`) | Web: consultas | — |
| PUT | `/web/respuestas` | Guarda las respuestas rápidas (hasta 20) | Web: consultas | `respuestas` (`[{titulo, texto}]`) |
| GET | `/web/resenas` | Reseñas que la gente dejó en el sitio (últimas 300) | Web: resenas | `?estado` (pendiente|aprobada|oculta) |
| PATCH | `/web/resenas/:id` | Aprueba, oculta o vuelve a dejar pendiente una reseña⁴³ | Web: resenas | `estado` |
| DELETE | `/web/resenas/:id` | Borra una reseña | Web: resenas | — |
| GET | `/web/galeria` | Las fotos de la página Galería y si el taller ya cargó alguna propia | Web | — |
| PUT | `/web/galeria` | Guarda la lista entera, en orden (hasta 40); sin ninguna, el sitio deja las de referencia | Web: paginas | `fotos` (`[{url, alt, etiqueta}]`) |
| POST | `/web/galeria/traer-del-sitio` | Trae al panel las 8 fotos que la galería del sitio muestra hoy⁵⁰ | Web: paginas | — |
| GET | `/web/faq` | Las preguntas frecuentes del sitio y si ya se configuraron | Web | — |
| PUT | `/web/faq` | Guarda los grupos con sus preguntas⁴⁶ | Web: paginas | `grupos` (`[{grupo, preguntas: [{p, r}]}]`) |
| GET | `/web/nosotros` | El texto, las cifras y la foto de la página Nosotros, si ya se escribió algo propio, y en `del_sitio` lo que el sitio muestra hoy, para traerlo | Web | — |
| PUT | `/web/nosotros` | Los guarda⁴⁹ | Web: paginas | `titulo`, `historia` (texto; una línea en blanco separa párrafos), `cifras` (`[{valor, etiqueta}]`), `foto` (`{url, alt}` o null) |
| GET | `/web/servicios` | Los servicios del sistema con lo que el sitio cuenta de cada uno, los grupos y los dibujos disponibles | Web | — |
| PUT | `/web/servicios` | Guarda grupos y textos; los nombres no se tocan, salen de la tabla `servicios`⁴⁷ | Web: negocio | `grupos` (`[{id?, nombre, descripcion}]`), `textos` (`{servicio_id: {visible, grupo, icono, resumen, incluye, cuando}}`) |
| GET | `/web/financiamiento` | Cómo está el financiamiento que muestra el sitio | Web | — |
| PUT | `/web/financiamiento` | Lo guarda; encenderlo a medias se rechaza⁴⁸ | Web: negocio | `activo`, `entidad`, `tasaAnual`, `primaMinima`, `plazos`, `plazoInicial`, `aplicaA` (todas\|nuevas), `requisitos` (`{asalariado, independiente}`), `nota` |
| GET | `/web/negocio` | Datos del negocio que muestra el sitio, más el horario de citas y en qué días no coinciden, y en `del_sitio` lo que el sitio muestra hoy (con `de_ejemplo`: los campos de relleno) | Web | — |
| PUT | `/web/negocio` | Guarda teléfono, WhatsApp, dirección, horario y foto por sede, correo y redes³⁹ | Web: negocio | `email`, `redes`, `marcas`, `sedes` (`{sucursal_id: {telefono, whatsapp, direccion, horarios, foto, foto_alt}}`; `foto`: subida desde el panel o https) |
| PUT | `/web/negocio/sedes/:id/foto` | Cambia solo la foto de una sede, sin tocar el resto de los datos del negocio (la usa la pantalla Nosotros) | Web: negocio | `foto` (subida desde el panel, https, o vacío para quitarla), `foto_alt` |
| GET | `/web/tipos` | Categorías del catálogo, con cuántas motos usa cada una | Web | — |
| PUT | `/web/tipos` | Guarda la lista entera (orden, nombres, altas y bajas)⁴² | Web: catalogo | `tipos` (`[{id?, nombre}]`) |
| GET | `/web/inicio-sitio` | La tira de motos del inicio del sitio, y cuáles están marcadas a mano | Web | — |
| PUT | `/web/inicio-sitio` | La guarda: encendida o no, textos, por fecha de ingreso o a mano, cuántas⁴⁰ | Web: catalogo | `nuevoIngreso` (`{activo, rotulo, titulo, modo, dias, maximo}`) |
| GET | `/web/formulario` | El formulario de cotización del sitio y los campos que se pueden configurar | Web | — |
| PUT | `/web/formulario` | Lo guarda: títulos y, por campo, obligatorio / opcional / no preguntar⁴¹ | Web: consultas | `titulo`, `intro`, `boton`, `campos` |
| GET | `/web/inicio` | Resumen de la sección: consultas, lo que le falta al catálogo y a los datos del negocio, las motos más consultadas | Web | — |
| GET | `/web/publicaciones` | Últimas 20 versiones publicadas (`restaurable`: si guarda lo necesario para volver a ella) | Web | — |
| POST | `/web/publicaciones/:id/restaurar` | Vuelve el panel **y** el sitio a esa versión (queda como una publicación nueva) | Web: publicar | — |
| PUT | `/web/programacion` | Programa una publicación (la corre `jobs/sitio-web.js`, cada 5 min) | Web: publicar | `fecha` (ISO, en el futuro, hasta un año) |
| DELETE | `/web/programacion` | Cancela la publicación programada | Web: publicar | — |

³² Poner o cambiar el precio exige además el permiso `precios`: sin él, una moto se puede
agregar o editar, pero con el precio vacío o sin tocar (403 si lo intenta).
³³ El `slug` (la dirección de la página de la moto) **no cambia al renombrarla**: Google,
WhatsApp y quien guardó el enlace ya lo conocen.
³⁴ Con `RAILWAY_API_TOKEN` y `WEB_RAILWAY_SERVICE_ID` definidos, le pide a Railway que
redespliegue el servicio del sitio (`services/despliegue-web.js`). Sin ellos, lo publicado
queda guardado igual y la respuesta lo dice.

⁵⁰ Solo con el catálogo (o la galería) vacío: con contenido adentro lo duplicaría o lo pisaría (409).
Es una copia de `motos.config.js` y `galeria.html` del sitio, guardada en
`backend/src/data/sitio-de-ejemplo.json`; los dos repos están separados y el sistema no lee los
archivos del sitio. Publicadas sin tocar, las motos salen igual que hoy (salvo la ficha técnica
descargable, que el panel no maneja). Las motos de una categoría que el taller quitó no entran, y se
dice cuáles.

## Sitio web: lo publicado · `/api/sitio`

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/sitio/contenido` | La última publicación, con la misma forma que `motos.config.js` y `promo.config.js` del sitio. **404** si todavía no se publicó nada | Público³⁵ | — |
| GET | `/sitio/fotos/:archivo` | Una foto subida desde el panel (`<clave de 24>.jpg|png|webp`), con caché de un año | Público | — |
| POST | `/sitio/consultas` | Recibe una consulta de los formularios del sitio y avisa por correo al taller³⁷ | Público | `tipo` (cotizacion|contacto|repuesto), `nombre`, `telefono` o `email`, `moto`, `sucursal`, `mensaje`, `website` (trampa) |
| GET | `/sitio/resenas` | Las reseñas aprobadas (hasta 20, de la más nueva a la más vieja) | Público | — |
| POST | `/sitio/resenas` | Recibe una reseña; queda pendiente hasta que alguien la aprueba en el panel⁴⁴ | Público | `nombre`, `calificacion` (1 a 5), `comentario`, `website` (trampa) |

³⁵ Público a propósito: es exactamente lo que el sitio le muestra a cualquiera. Solo sale lo
publicado; lo que se está editando no. Lo baja `scripts/bajar-contenido.js` del sitio, que
también se baja las fotos del panel para servirlas él mismo.
³⁶ Se revisa que los primeros bytes coincidan con el tipo declarado (un "jpg" que no lo es
no entra) y hay un tope de 2,5 MB. SVG y GIF no se aceptan.
⁴² El `id` de una categoría se arma de su nombre al crearla y no vuelve a cambiar: va en la dirección del catálogo filtrado y en la ruta de cada moto, así que renombrarla no rompe enlaces. Una categoría que todavía tiene motos no se puede quitar (**409** con el detalle).
⁴⁰ En modo `manual` salen las motos con `destacada` (se marcan desde el catálogo); en `automatico`, las que ingresaron en los últimos `dias`, que se vacían solas.
⁴¹ La moto y el nombre no se pueden quitar, y no se pueden ocultar el teléfono y el correo a la vez: sin uno de los dos no hay cómo contestar.
³⁸ Es el único punto de la sección Sitio web que escribe en datos del taller (`clientes`).
³⁹ Se guardan aparte, en `web_ajustes` ('negocio'): no tocan `sucursales` ni `configuracion`, que solo se leen.
³⁷ `/api/sitio` está abierto a cualquier origen en CORS (el sitio vive en otro dominio).
Límite propio: 6 consultas por hora por IP. Si `website` llega lleno (un robot), responde
201 y no guarda nada.
⁴³ Las reseñas no pasan por `POST /web/publicar`: el sitio las pide en vivo a
`/sitio/resenas`, así que aprobar u ocultar una se ve en ese momento.
⁴⁴ Límite propio: 5 reseñas por hora por IP. Con `website` lleno, igual que las consultas.

⁴⁵ Dos pasos a propósito: sin `confirmar` no escribe nada, solo devuelve cada línea con su
error o con lo que va a crear. Las buenas entran aunque otras estén malas; una categoría que
no existe se rechaza en vez de inventarse. Hasta 300 líneas por archivo.

⁴⁶ La respuesta llega como un texto y se guarda partida en párrafos (una línea en blanco los
separa). `[texto](destino)` se vuelve un enlace, para poder mandar a otra página del sitio sin
escribir HTML. Hasta 12 grupos y 30 preguntas en total.

⁴⁷ Los nombres salen de la tabla `servicios` del sistema: así el sitio nunca ofrece algo que
el portal no deja agendar, ni se queda con un nombre viejo. Si un servicio no tiene dibujo
elegido, el sitio usa uno que pegue con su nombre.

⁴⁸ Apagado, el sitio no lo menciona en ninguna parte. Para encenderlo hacen falta quién
financia, tasa, prima y al menos un plazo: una cuota mal calculada en la web es una promesa
que el cliente trae impresa.

⁴⁹ Las cifras («+12 años de experiencia») son lo delicado de esta página: el cliente las lee
como una promesa del negocio. Se pueden dejar en cero — mejor ninguna cifra que una inventada —
y una a medias se rechaza. Si no hay ni título ni historia ni foto, el sitio se queda con la
página que trae escrita, en vez de publicar una a medio llenar.

## Estado del servicio

| Método | Ruta | Descripción | Rol | Body / parámetros |
|---|---|---|---|---|
| GET | `/health` | Verificación de salud: `{ ok: true, ts }` | Público | — |

Exento del límite de tasa: lo sondea la plataforma con frecuencia.

---

## Cómo mantener este documento

Las rutas se definen con `router.<método>('<ruta>', …)` en `backend/src/routes/`. Para
listar todo lo que existe hoy y contrastarlo con estas tablas:

```bash
grep -rhoE "router\.(get|post|put|patch|delete)\('[^']*'" backend/src/routes/ | wc -l
```

Ese número —**264**— tiene que coincidir con el total del índice menos `/api/health`, que
se declara directo en `server.js` y no en un router.
