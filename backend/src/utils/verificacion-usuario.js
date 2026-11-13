// Verificación del correo del personal (hoy: el dueño que registra el taller).
//
// Por qué hace falta: el alta acepta cualquier dirección sin comprobarla. Un dedazo en
// el correo del admin deja la cuenta sin recuperación de contraseña posible —es la única
// vía— y sin forma de que Motiq avise nada, empezando por el fin de la prueba.
//
// Por qué NO bloquea: pedirle a alguien que salga a revisar su bandeja antes de dejarlo
// ver el producto que acaba de registrar es exactamente la fricción que sobra. Se avisa
// en pantalla y se sigue trabajando.
//
// El mecanismo es el mismo del portal de clientes (código de 6 dígitos, hash con bcrypt,
// 10 minutos, un solo uso, tope de intentos), sobre su propia tabla.
const bcrypt = require('bcrypt');
const crypto = require('node:crypto');
const { canjearCodigo } = require('./codigos-un-uso');

const VIGENCIA_MIN = 10;
const MAX_INTENTOS = 5;

// Código de 6 dígitos para verificar un correo, recuperar una contraseña o entrar sin
// ella. Abre una cuenta, así que sale del generador criptográfico del sistema y no de
// Math.random, cuya secuencia se puede deducir. Es la única copia: todos los flujos
// (personal y clientes) la usan.
const codigoDeSeisDigitos = () => String(crypto.randomInt(100000, 1000000));

// Genera y guarda un código nuevo, invalidando los anteriores: si conviven dos, el
// usuario prueba el del correo viejo y no entiende por qué le dice que está mal.
async function nuevoCodigo(db, usuarioId) {
  const codigo = codigoDeSeisDigitos();
  const codeHash = await bcrypt.hash(codigo, 10);
  await db.query(
    'UPDATE usuario_verify_codes SET used = 1 WHERE tenant_id = @tenant AND usuario_id = ? AND used = 0',
    [usuarioId]
  );
  await db.query(
    `INSERT INTO usuario_verify_codes (tenant_id, usuario_id, code_hash, expires_at)
     VALUES (@tenant, ?, ?, NOW() + ?::int * INTERVAL '1 minute')`,
    [usuarioId, codeHash, VIGENCIA_MIN]
  );
  return codigo;
}

// Canjea el código. Devuelve null si estaba bien, o el motivo del rechazo.
//
// El motivo se devuelve en vez de lanzarse porque los tres casos (vencido, equivocado,
// demasiados intentos) le piden cosas distintas a quien está del otro lado.
async function canjear(db, usuarioId, codigo) {
  const [[reg]] = await db.query(
    `SELECT id, code_hash, attempts FROM usuario_verify_codes
      WHERE tenant_id = @tenant AND usuario_id = ? AND used = 0 AND expires_at > NOW()
      ORDER BY id DESC LIMIT 1`,
    [usuarioId]
  );
  if (!reg) return 'El código venció o ya se usó. Pedí uno nuevo.';
  if (reg.attempts >= MAX_INTENTOS) return 'Demasiados intentos con ese código. Pedí uno nuevo.';

  // Intento contado y código quemado por la base (B-09): de dos pedidos con el mismo
  // código, uno solo verifica.
  const resultado = await canjearCodigo(db, 'usuario_verify_codes', reg, codigo, MAX_INTENTOS);
  if (resultado === 'incorrecto') return 'El código no es correcto.';
  if (resultado !== 'ok') return 'El código venció o ya se usó. Pedí uno nuevo.';

  await db.query(
    'UPDATE usuarios SET email_verificado = 1 WHERE id = ? AND tenant_id = @tenant',
    [usuarioId]
  );
  return null;
}

module.exports = { codigoDeSeisDigitos, nuevoCodigo, canjear, VIGENCIA_MIN };
