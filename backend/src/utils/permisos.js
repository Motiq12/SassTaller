// Roles del personal y lo que puede hacer cada uno (las "casillas").
//
// Cada rol parte de una de las pantallas que ya existen (su "base"): Administración,
// Mostrador (recepción), Taller (mecánico) o Sitio web. Las casillas dicen qué puede
// hacer adentro. Los cuatro roles de fábrica tienen exactamente lo que cada rol podía
// hacer antes de que existieran las casillas, así nadie gana ni pierde nada.
//
// Lo que el rol puede VER lo decide aparte la sucursal de cada persona
// (utils/alcance.js), no el rol.
//
// Las casillas del sitio web (utils/permisos-web.js) por ahora se siguen marcando por
// persona, en Gestión de empleados.

const BASES = {
  administracion: 'Administración',
  mostrador: 'Mostrador (recepción)',
  taller: 'Taller (mecánico)',
  web: 'Sitio web',
};

// El orden es el de la pantalla de Roles.
const CATALOGO = [
  { grupo: 'Citas', permisos: [
    { id: 'citas.ver', nombre: 'Ver la agenda' },
    { id: 'citas.agendar', nombre: 'Agendar y reprogramar' },
    { id: 'citas.cancelar', nombre: 'Cancelar citas' },
    { id: 'citas.duracion', nombre: 'Cambiar cuánto dura una cita' },
    { id: 'citas.bloquear', nombre: 'Bloquear horario' },
  ] },
  { grupo: 'Órdenes de trabajo', permisos: [
    { id: 'ordenes.crear', nombre: 'Abrir órdenes' },
    { id: 'ordenes.editar', nombre: 'Editar órdenes' },
    { id: 'ordenes.eliminar', nombre: 'Eliminar órdenes' },
    { id: 'ordenes.asignar', nombre: 'Asignar mecánico' },
    { id: 'ordenes.estado', nombre: 'Cambiar el estado' },
    { id: 'ordenes.precios', nombre: 'Ver precios y costos' },
    { id: 'ordenes.costos', nombre: 'Editar costos y repuestos' },
    { id: 'ordenes.entregar', nombre: 'Entregar y cobrar' },
    { id: 'ordenes.facturar', nombre: 'Facturar' },
  ] },
  { grupo: 'Clientes', permisos: [
    { id: 'clientes.ver', nombre: 'Ver clientes y vehículos' },
    { id: 'clientes.editar', nombre: 'Crear y editar clientes' },
    { id: 'clientes.eliminar', nombre: 'Eliminar clientes' },
    { id: 'clientes.portal', nombre: 'Dar acceso al portal' },
  ] },
  { grupo: 'Taller', permisos: [
    { id: 'taller.trabajar', nombre: 'Trabajar las órdenes que tiene asignadas' },
    { id: 'taller.repuestos', nombre: 'Pedir repuestos' },
    { id: 'taller.fotos', nombre: 'Subir fotos de evidencia' },
  ] },
  { grupo: 'Equipo', permisos: [
    { id: 'equipo.mensajes', nombre: 'Mensajes del equipo' },
    { id: 'equipo.tareas', nombre: 'Asignar tareas' },
    { id: 'equipo.empleados', nombre: 'Gestionar empleados y roles' },
  ] },
  { grupo: 'Análisis', permisos: [
    { id: 'analisis.reportes', nombre: 'Reportes y resumen' },
    { id: 'analisis.opiniones', nombre: 'Opiniones de clientes' },
    { id: 'analisis.promociones', nombre: 'Promociones del portal' },
  ] },
  { grupo: 'Configuración', permisos: [
    { id: 'config.taller', nombre: 'Información del taller' },
    { id: 'config.horarios', nombre: 'Horario y capacidad' },
    { id: 'config.sucursales', nombre: 'Sucursales' },
    { id: 'config.entrega', nombre: 'Entrega y cobro' },
    { id: 'config.notificaciones', nombre: 'Notificaciones' },
  ] },
];
const TODOS = CATALOGO.flatMap((g) => g.permisos.map((p) => p.id));

// Lo que cada rol podía hacer antes de las casillas (ver rutas con requireRol/soloRoles).
const ROLES_FABRICA = [
  {
    clave: 'admin', nombre: 'Administrador', base: 'administracion',
    descripcion: 'El dueño: puede todo y ve las dos sucursales. No se puede cambiar.',
    permisos: TODOS,
  },
  {
    clave: 'recepcion', nombre: 'Recepción', base: 'mostrador',
    descripcion: 'Atiende el mostrador: agenda, recibe vehículos, arma cotizaciones, entrega y cobra.',
    permisos: [
      'citas.ver', 'citas.agendar', 'citas.cancelar',
      'ordenes.crear', 'ordenes.editar', 'ordenes.asignar', 'ordenes.estado', 'ordenes.precios',
      'ordenes.costos', 'ordenes.entregar', 'ordenes.facturar',
      'clientes.ver', 'clientes.editar', 'clientes.eliminar',
      'taller.fotos', 'equipo.mensajes',
    ],
  },
  {
    clave: 'tecnico', nombre: 'Mecánico', base: 'taller',
    descripcion: 'Trabaja las órdenes y citas que tiene asignadas. No ve precios.',
    permisos: ['citas.ver', 'ordenes.estado', 'taller.trabajar', 'taller.repuestos', 'taller.fotos', 'equipo.mensajes'],
  },
  {
    clave: 'contenido', nombre: 'Contenido del sitio web', base: 'web',
    descripcion: 'Solo entra a la sección Sitio web, con lo que se le marque a cada persona. No ve nada del taller.',
    permisos: [],
  },
];

// ───────────────────────────────────────────────────────────
// Roles propios (parte 2). Un rol propio parte de Mostrador o de Taller y solo puede
// QUITAR casillas de lo que esa base ya permite: nunca da más que lo que hoy tiene
// Recepción o Mecánico. Roles sobre la base Administración (un gerente de sucursal)
// quedan para más adelante: piden revisar las rutas del panel, que hoy son solo del
// dueño.
//
// Cada base tiene:
//   techo      lo máximo que puede tener (lo del rol de fábrica de esa base);
//   fijas      lo que tiene siempre, porque sin eso su pantalla no funciona, o porque
//              el servidor todavía no lo puede controlar (facturar se arma en la
//              pantalla, sin una ruta propia);
//   ajustables el resto del techo: lo único que se elige con casillas.
//
// Una casilla que no es ajustable para la base de alguien no se revisa nunca: esa
// persona puede o no puede como antes de que hubiera casillas (lo deciden requireRol y
// soloRoles). Así los roles de fábrica, con sus casillas de siempre, funcionan igual.
// ───────────────────────────────────────────────────────────

// La base de cada rol del sistema (usuarios.rol) y al revés.
const BASE_DE_ROL = { admin: 'administracion', recepcion: 'mostrador', tecnico: 'taller', contenido: 'web' };
const ROL_DE_BASE = { administracion: 'admin', mostrador: 'recepcion', taller: 'tecnico', web: 'contenido' };

// Bases sobre las que se pueden crear roles propios.
const BASES_PROPIAS = ['mostrador', 'taller'];

const FIJAS = {
  mostrador: ['citas.ver', 'clientes.ver', 'ordenes.precios', 'ordenes.facturar'],
  taller: ['citas.ver', 'ordenes.estado', 'taller.trabajar'],
};

const fabricaDe = (rol) => ROLES_FABRICA.find((r) => r.clave === rol);

function techo(base) {
  const r = fabricaDe(ROL_DE_BASE[base]);
  return r ? r.permisos : [];
}

function ajustables(base) {
  const fijas = FIJAS[base] || [];
  return BASES_PROPIAS.includes(base) ? techo(base).filter((p) => !fijas.includes(p)) : [];
}

// Lo que puede hacer alguien con el rol del sistema `rol` (usuarios.rol). `asignado`
// es su rol de la tabla roles ({ base, permisos }): el propio si tiene uno de su misma
// base, o si no el de fábrica de su rol (que también se puede editar). Lo que venga de
// más se descarta: nada pasa del techo, y las fijas están siempre.
function permisosEfectivos(rol, asignado) {
  if (rol === 'admin') return [...TODOS];
  const base = BASE_DE_ROL[rol];
  if (!BASES_PROPIAS.includes(base)) return [];
  const elegidos = asignado && asignado.base === base && Array.isArray(asignado.permisos)
    ? asignado.permisos
    : (fabricaDe(rol) || { permisos: [] }).permisos;
  const aj = ajustables(base);
  return [...new Set([...(FIJAS[base] || []), ...elegidos.filter((p) => aj.includes(p))])];
}

// ¿Esta persona (rol del sistema + sus permisos efectivos) puede hacer `permiso`?
// Si la casilla no es ajustable para su base, no se revisa: decide la ruta, como antes.
function puede(rol, efectivos, permiso) {
  if (rol === 'admin') return true;
  const base = BASE_DE_ROL[rol];
  if (!ajustables(base).includes(permiso)) return true;
  return (efectivos || []).includes(permiso);
}

const NOMBRE_PERMISO = Object.fromEntries(CATALOGO.flatMap((g) => g.permisos.map((p) => [p.id, p.nombre])));

const MAX_NOMBRE_ROL = 60;
const MAX_DESCRIPCION_ROL = 200;

// Valida un rol propio que llega del panel. `base` solo se acepta al crear (después no
// se cambia: movería de pantalla a todos los que lo tienen). Devuelve
// { datos } o { error, campo }.
function validarRolPropio(body, { baseFija } = {}) {
  const nombre = String(body?.nombre ?? '').trim();
  if (nombre.length < 2) return { error: 'Escribí el nombre del rol', campo: 'nombre' };
  if (nombre.length > MAX_NOMBRE_ROL) return { error: `El nombre no puede pasar de ${MAX_NOMBRE_ROL} caracteres`, campo: 'nombre' };
  const base = baseFija || String(body?.base ?? '');
  if (!BASES_PROPIAS.includes(base)) return { error: 'Elegí de qué parte del sistema es el rol', campo: 'base' };
  const descripcion = String(body?.descripcion ?? '').trim();
  if (descripcion.length > MAX_DESCRIPCION_ROL) {
    return { error: `La descripción no puede pasar de ${MAX_DESCRIPCION_ROL} caracteres`, campo: 'descripcion' };
  }
  if (body?.permisos !== undefined && !Array.isArray(body.permisos)) return { error: 'Casillas no válidas', campo: 'permisos' };
  const pedidos = Array.isArray(body?.permisos) ? body.permisos.map(String) : [];
  const desconocido = pedidos.find((p) => !TODOS.includes(p));
  if (desconocido) return { error: 'Hay una casilla que no existe', campo: 'permisos' };
  const aj = ajustables(base);
  const deMas = pedidos.find((p) => !aj.includes(p) && !(FIJAS[base] || []).includes(p));
  if (deMas) {
    return { error: `«${NOMBRE_PERMISO[deMas]}» no se puede dar en un rol de ${BASES[base].toLowerCase()}`, campo: 'permisos' };
  }
  // Se guardan solo las ajustables: las fijas se suman siempre al calcular.
  const permisos = [...new Set(pedidos.filter((p) => aj.includes(p)))];
  return { datos: { nombre, base, descripcion: descripcion || null, permisos } };
}

module.exports = {
  BASES, CATALOGO, TODOS, ROLES_FABRICA,
  BASE_DE_ROL, ROL_DE_BASE, BASES_PROPIAS, FIJAS, techo, ajustables,
  permisosEfectivos, puede, NOMBRE_PERMISO, validarRolPropio, MAX_NOMBRE_ROL, MAX_DESCRIPCION_ROL,
};
