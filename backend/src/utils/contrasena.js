// Contraseñas del personal: el mínimo lo elige administración en Configuración →
// Seguridad (pass_min_largo y pass_variedad). Vale para las contraseñas nuevas: las
// que ya están siguen sirviendo hasta que cada uno la cambie. Los clientes del portal
// tienen su propio piso (8), aparte.

// Las que se prueban primero en cualquier ataque. En minúsculas y sin espacios.
const COMUNES = new Set([
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '12341234',
  'password', 'password1', 'contrasena', 'contraseña', 'qwerty123', 'qwertyui', 'abc12345',
  'msmotos', 'msmotos1', 'msmotos123', 'msmotors', 'taller123', 'motos123', 'admin123', 'administrador',
]);

const MIN_ABSOLUTO = 8;
const MAX_LARGO = 128;

// La política vigente a partir de la configuración del taller.
function politica(config = {}) {
  const min = Math.round(Number(config.pass_min_largo));
  return {
    minimo: Number.isFinite(min) ? Math.min(Math.max(min, MIN_ABSOLUTO), 32) : MIN_ABSOLUTO,
    variedad: !!Number(config.pass_variedad),
  };
}

// Qué tiene de malo la contraseña, o null si sirve. `quien` ({ email, nombre }) evita
// que la contraseña sea el propio correo o el nombre.
function problemaDeContrasena(clave, pol, quien = {}) {
  const p = String(clave ?? '');
  if (p.length < pol.minimo) return `La contraseña debe tener al menos ${pol.minimo} caracteres`;
  if (p.length > MAX_LARGO) return `La contraseña no puede pasar de ${MAX_LARGO} caracteres`;
  if (pol.variedad && !(/\p{L}/u.test(p) && /\d/.test(p))) return 'La contraseña tiene que tener letras y números';
  const plana = p.toLowerCase().replace(/\s+/g, '');
  if (COMUNES.has(plana) || /^(.)\1+$/.test(plana)) return 'Esa contraseña es de las más usadas: elegí otra';
  const usuarioCorreo = String(quien.email || '').toLowerCase().split('@')[0];
  if (usuarioCorreo.length >= 4 && plana.includes(usuarioCorreo)) return 'La contraseña no puede llevar el correo de la cuenta';
  const nombre = String(quien.nombre || '').toLowerCase().split(/\s+/)[0] || '';
  if (nombre.length >= 4 && plana.startsWith(nombre) && /^\d*$/.test(plana.slice(nombre.length))) {
    return 'La contraseña no puede ser el nombre con números';
  }
  return null;
}

module.exports = { politica, problemaDeContrasena, MIN_ABSOLUTO };
