// Canje de los códigos de 6 dígitos de un solo uso (B-09): verificación de correo,
// recuperación de contraseña, ingreso por código y cambio de correo.
//
// Antes cada ruta leía el código, lo comparaba y recién después lo marcaba usado con un
// UPDATE incondicional. Dos pedidos simultáneos con el mismo código leían los dos
// `used = 0`, los dos pasaban el bcrypt y los dos aplicaban el efecto (dos sesiones, dos
// cambios de contraseña). Lo mismo con el tope de intentos: N intentos en paralelo leían
// todos `attempts < 5` y se comparaban todos.
//
// Ahora la base decide, con UPDATE condicionados que solo puede ganar uno:
//   1. reservarIntento: suma el intento ANTES de comparar, y solo si el código sigue
//      vivo y por debajo del tope. Los intentos en paralelo no pasan el tope.
//   2. quemar: `used = 1 WHERE used = 0`. De dos pedidos con el código correcto, uno
//      afecta la fila y el otro no; ese otro se rechaza sin aplicar nada.
// El efecto (sesión, contraseña, correo) va DESPUÉS de quemar: nunca sin haber ganado.
const bcrypt = require('bcrypt');

const TABLAS = new Set([
  'email_verify_codes', 'login_codes', 'password_reset_codes', 'usuario_reset_codes', 'usuario_verify_codes',
]);
function tabla(nombre) {
  if (!TABLAS.has(nombre)) throw new Error(`codigos-un-uso: tabla no prevista (${nombre})`);
  return nombre;
}

async function reservarIntento(db, nombre, id, max) {
  const [r] = await db.query(
    `UPDATE ${tabla(nombre)} SET attempts = attempts + 1
      WHERE id = ? AND tenant_id = @tenant AND used = 0 AND expires_at > NOW() AND attempts < ?`,
    [id, max]
  );
  return r.affectedRows === 1;
}

async function quemar(db, nombre, id) {
  const [r] = await db.query(
    `UPDATE ${tabla(nombre)} SET used = 1 WHERE id = ? AND tenant_id = @tenant AND used = 0 AND expires_at > NOW()`,
    [id]
  );
  return r.affectedRows === 1;
}

// Compara el código contra el registro leído y lo canjea. Devuelve:
//   'ok'         el código era correcto y este pedido es el único que lo usó;
//   'incorrecto' no coincide (el intento ya quedó contado);
//   'agotado'    venció, ya se usó o llegó al tope, aunque la lectura dijera otra cosa.
async function canjearCodigo(db, nombre, reg, codigo, max) {
  if (!(await reservarIntento(db, nombre, reg.id, max))) return 'agotado';
  if (!(await bcrypt.compare(String(codigo ?? '').trim(), reg.code_hash))) return 'incorrecto';
  return (await quemar(db, nombre, reg.id)) ? 'ok' : 'agotado';
}

module.exports = { canjearCodigo, reservarIntento, quemar };
