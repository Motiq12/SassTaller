// Preferencias propias del personal (Mi perfil), en `usuarios.preferencias` (JSON):
//   inicio:     pantalla con la que arranca al entrar ('/admin/citas', …)
//   sede_id:    la sede que ve primero en las listas que filtran por sede (null = todas)
//   avisos_off: tipos de aviso de la campana que no quiere ver
// Son gustos de cada quien: no dan ni quitan permisos.

const { pool } = require('../db/pool');

// Avisos de la campana que se pueden apagar, por rol (los mismos `tipo` que arman
// /recepcion/alertas y /mecanico/alertas).
const AVISOS = {
  recepcion: ['foto', 'lista', 'aprobacion', 'cita_nueva', 'cita_cancelada', 'repuesto', 'sin_entregar'],
  tecnico: ['mensaje', 'cita_asignada', 'orden_estado'],
};

// Dónde puede arrancar cada rol: dentro de su propio panel.
const PREFIJO_INICIO = { admin: '/admin/', recepcion: '/recepcion/', tecnico: '/mecanico/' };

function leer(texto) {
  try {
    const p = JSON.parse(texto || '{}');
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  } catch { return {}; }
}

// Deja solo lo que vale para ese rol; lo demás se descarta sin error.
function normalizarPreferencias(entrada, rol) {
  const e = entrada && typeof entrada === 'object' ? entrada : {};
  const out = { inicio: null, sede_id: null, avisos_off: [] };
  const prefijo = PREFIJO_INICIO[rol];
  if (prefijo && typeof e.inicio === 'string' && e.inicio.startsWith(prefijo) && /^\/[a-z]+\/[a-z-]+$/.test(e.inicio)) out.inicio = e.inicio;
  const sede = Number(e.sede_id);
  if (Number.isInteger(sede) && sede > 0) out.sede_id = sede;
  const validos = AVISOS[rol] || [];
  if (Array.isArray(e.avisos_off)) out.avisos_off = [...new Set(e.avisos_off.filter((t) => validos.includes(t)))];
  return out;
}

async function preferenciasDe(usuarioId, rol) {
  const [[u]] = await pool.query('SELECT preferencias FROM usuarios WHERE id = ?', [usuarioId]);
  return normalizarPreferencias(leer(u?.preferencias), rol);
}

// Saca de la campana los avisos que la persona apagó. Si no se pueden leer sus
// preferencias, se muestran todos (mejor de más que perder un aviso).
async function filtrarAvisos(usuarioId, rol, lista) {
  try {
    const { avisos_off } = await preferenciasDe(usuarioId, rol);
    return avisos_off.length ? lista.filter((a) => !avisos_off.includes(a.tipo)) : lista;
  } catch {
    return lista;
  }
}

module.exports = { AVISOS, normalizarPreferencias, preferenciasDe, filtrarAvisos };
