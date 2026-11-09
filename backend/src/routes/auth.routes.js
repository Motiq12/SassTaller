const router = require('express').Router();
const { paraTenant } = require('../db/tenant-db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
// `pool` (sin scope) se usa a propósito y SOLO en /login: ahí todavía no se sabe a
// qué taller pertenece quien entra — justamente es lo que hay que averiguar. Las
// rutas autenticadas de este archivo usan req.db como todas las demás.
const { pool } = require('../db/pool');
const { fail, invalido, faltante } = require('../utils/responder');
const auth = require('../middleware/auth');
const { emailValido } = require('../utils/validar');
const { consumir } = require('../utils/rate-limit');
const { resumenCuenta } = require('../utils/cuenta');
const { nuevoCodigo, canjear, VIGENCIA_MIN } = require('../utils/verificacion-usuario');
const { enviarCodigoCorreoStaff, enviarCodigoReset } = require('../services/mailer');
const { antibot } = require('../utils/antibot');
const totp = require('../utils/totp');
const { normalizarPermisos } = require('../utils/permisos-web');
const { permisosDeUsuario } = require('../middleware/permisos');
const {
  nuevoSid, abrirSesion, describirAgente, sesionesAbiertas, cerrarSesionPropia, cerrarOtrasSesiones, cerrarSid,
} = require('../utils/sesiones');
const { anotar, actividadDe } = require('../utils/actividad');
const { registrarEvento } = require('../utils/eventos-seguridad');
const { AVISOS, normalizarPreferencias, preferenciasDe } = require('../utils/preferencias');
const { getConfig } = require('../utils/configuracion');
const { politica } = require('../utils/contrasena');

function firmar(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
}

// Cuándo entró por última vez alguien del personal (lo ve Configuración → Seguridad).
function anotarIngreso(usuarioId) {
  pool.query('UPDATE usuarios SET ultimo_ingreso = CURRENT_TIMESTAMP WHERE id = ?', [usuarioId])
    .catch((e) => console.error('No se pudo anotar el ingreso:', e.code || e.message));
}

// Abre la sesión del personal: la anota con su dispositivo (Mi perfil → Sesiones) y
// firma el token con ese `sid`. Si no se pudo anotar, firma sin sid y entra igual.
async function sesionStaff(usuario, req) {
  // tenant_id va en el token: es de donde lo saca middleware/tenant para acotar
  // req.db. Sin él, auth encadena a tenant y tenant rechaza TODO con 401.
  const payload = { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol, tenant_id: usuario.tenant_id };
  const sid = nuevoSid();
  const token = firmar({ ...payload, sid });
  const ok = await abrirSesion(usuario.id, req, jwt.decode(token).exp, sid);
  anotarIngreso(usuario.id);
  anotar(usuario.id, 'ingreso', describirAgente(req.headers['user-agent']));
  return { payload, token: ok ? token : firmar(payload) };
}

// Token PARCIAL de 2FA: se emite cuando la contraseña fue correcta pero falta el
// segundo factor. NO lleva `rol`, así que `middleware/auth` (que exige rol y rechaza
// `pend2fa`) lo bloquea en todas las rutas del sistema: solo sirve para canjearlo en
// /auth/2fa/verificar, y vive 5 minutos.
// Lleva el taller: la contraseña ya se validó, así que en este punto se sabe de qué
// taller es el usuario. Sin esto, al canjear el código habría que volver a buscarlo
// sin scope, que es justo lo que queremos evitar.
function firmarParcial(usuarioId, tenantId) {
  return jwt.sign({ id: usuarioId, tenant_id: tenantId, pend2fa: true }, process.env.JWT_SECRET, { expiresIn: '5m' });
}

// Hash señuelo (bcrypt válido) para igualar el tiempo de respuesta cuando el correo
// no existe: sin esto, un login a un correo inexistente respondería más rápido (no
// corre bcrypt), revelando qué cuentas existen. Se calcula una sola vez al cargar.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', 10);

// Login unificado: el mismo formulario sirve para personal y para clientes.
// Busca primero en usuarios (personal) y, si no, en clientes con acceso al portal.
// La respuesta incluye `tipo` ('staff' | 'cliente') para que el front sepa a dónde mandar.
router.post('/login', async (req, res) => {
  try {
    const { email, password, taller } = req.body;
    if (!email || !password) {
      return faltante(res, req.body, [['email', 'el correo'], ['password', 'la contraseña']]);
    }
    if (!emailValido(email)) {
      return invalido(res, 'email', 'El correo no tiene un formato válido');
    }

    // Multi-tenant: el email ya no es único global, solo dentro de un taller. Si el
    // front manda el taller (subdominio/slug), la búsqueda se acota a ese. Si no lo
    // manda, se resuelve por el correo y solo se acepta si aparece en UNO solo;
    // ante ambigüedad se le pide al usuario que elija, en vez de adivinar.
    let tenantId = null;
    if (taller) {
      const [[t]] = await pool.query(
        "SELECT id FROM tenants WHERE slug = ? AND estado = 'activo'",
        [String(taller).trim().toLowerCase()]
      );
      if (!t) return res.status(404).json({ error: 'Taller no encontrado o inactivo' });
      tenantId = t.id;
    }

    // Anti fuerza-bruta: limita intentos por correo (10/min, 60/hora).
    const limite = consumir(`login:${String(email).trim().toLowerCase()}`, { porMinuto: 10, porHora: 60 });
    if (!limite.ok) {
      registrarEvento('login_bloqueado', { email, ip: req.ip });
      // Sin voseo: esta entrada es la misma para el personal y para los clientes (a
      // ellos se les habla de tú).
      return res.status(429).json({ error: `Demasiados intentos. Se puede volver a probar en ${limite.retryAfter} segundos.` });
    }

    // 1) Personal del taller (usuarios). Sin `taller` puede haber varios candidatos
    // (mismo correo en talleres distintos), así que se resuelve por contraseña: se
    // compara contra todos y se acepta si coincide en UNO. Desambiguar recién
    // después de validar evita revelar en qué talleres existe un correo.
    const [candidatos] = await pool.query(
      tenantId
        ? 'SELECT * FROM usuarios WHERE email = ? AND activo = 1 AND tenant_id = ?'
        : 'SELECT * FROM usuarios WHERE email = ? AND activo = 1',
      tenantId ? [email, tenantId] : [email]
    );
    const validos = [];
    for (const c of candidatos) {
      if (await bcrypt.compare(password, c.password_hash)) validos.push(c);
    }
    if (validos.length > 1) {
      // La contraseña ya se validó, así que listar los talleres no filtra nada nuevo.
      const [talleres] = await pool.query(
        `SELECT id, nombre, slug FROM tenants WHERE id IN (${validos.map(() => '?').join(',')})`,
        validos.map(v => v.tenant_id)
      );
      return res.status(409).json({ error: 'Ese correo está en varios talleres. Elegí uno.', talleres });
    }
    const usuario = validos[0];
    if (usuario) {
      // Con verificación en dos pasos activa, la contraseña sola no abre sesión:
      // se devuelve un token parcial que solo sirve para canjear el código.
      if (usuario.totp_activado) {
        return res.json({ data: { requiere_2fa: true, tipo: 'staff', token_parcial: firmarParcial(usuario.id, usuario.tenant_id) } });
      }
      // Los permisos del sitio web van en la respuesta (el panel arma su menú con
      // ellos) pero NO en el token: la API los relee en cada petición.
      const { payload, token } = await sesionStaff(usuario, req);
      return res.json({ data: { token, tipo: 'staff', usuario: { ...payload, permisos_web: normalizarPermisos(usuario.permisos_web), ...(await casillasDeSesion(usuario.id)), preferencias: await preferenciasDe(usuario.id, usuario.rol), foto: usuario.foto || null } } });
    }

    // 2) Cliente del portal (clientes con contraseña definida)
    const [[cliente]] = await pool.query(
      tenantId
        ? 'SELECT * FROM clientes WHERE email = ? AND activo = 1 AND password_hash IS NOT NULL AND tenant_id = ?'
        : 'SELECT * FROM clientes WHERE email = ? AND activo = 1 AND password_hash IS NOT NULL',
      tenantId ? [email, tenantId] : [email]
    );
    if (cliente && (await bcrypt.compare(password, cliente.password_hash))) {
      // Mismo criterio que /portal/login: la contraseña sola no alcanza mientras el
      // correo no esté confirmado. Sin esto, cualquiera podía "reclamar" en
      // /portal/registro un cliente que el taller cargó sin contraseña, ponerle la
      // suya y entrar por acá sin haber visto nunca el código del correo.
      // La contraseña ya se comprobó, así que avisarlo no enumera cuentas.
      if (!cliente.email_verificado) {
        return res.status(403).json({
          error: 'Confirmá tu correo para entrar. Te enviamos un código al registrarte.',
          requiere_verificacion: true,
        });
      }
      const payload = {
        id: cliente.id, tipo: 'cliente', nombre: cliente.nombre,
        apellido: cliente.apellido, tenant_id: cliente.tenant_id,
      };
      // La foto va en la respuesta (para el header), NO en el token (lo mantiene liviano).
      return res.json({ data: { token: firmar(payload), tipo: 'cliente', cliente: { ...payload, foto: cliente.foto || null } } });
    }

    // Anti-enumeración: si el correo no existía en ninguna tabla, no se ejecutó
    // ningún bcrypt.compare; corré uno señuelo para no delatar la cuenta por timing.
    // Se mira `candidatos` (existencia del correo) y no `usuario` (contraseña válida):
    // con la contraseña equivocada ya se corrió un bcrypt real y no hace falta otro.
    if (!candidatos.length && !cliente) {
      await bcrypt.compare(password, DUMMY_HASH);
    }
    registrarEvento('login_fallido', { email, ip: req.ip, detalle: usuario ? 'personal' : cliente ? 'cliente' : 'cuenta inexistente' });
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  } catch (err) {
    fail(res, err);
  }
});

// Las casillas de su rol para la sesión del panel (Equipo → Roles), desde que entra:
// así ninguna pantalla muestra un botón que el servidor le va a rechazar.
async function casillasDeSesion(usuarioId) {
  const p = await permisosDeUsuario(usuarioId);
  return { permisos: p.permisos, permisos_ajustables: p.ajustables, rol_id: p.rolId, rol_nombre: p.rolNombre };
}

router.get('/me', auth, async (req, res) => {
  try {
    const [[usuario]] = await pool.query(
      'SELECT id, nombre, email, rol, activo, email_verificado, created_at, permisos_web, foto FROM usuarios WHERE id = ?',
      [req.usuario.id]
    );
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
    // Las casillas de su rol (Equipo → Roles): el panel esconde lo que no puede hacer.
    // Es solo para la pantalla; el servidor las vuelve a revisar en cada ruta.
    const p = await permisosDeUsuario(usuario.id);
    res.json({
      data: {
        ...usuario,
        permisos_web: normalizarPermisos(usuario.permisos_web),
        permisos: p.permisos,
        permisos_ajustables: p.ajustables,
        rol_nombre: p.rolNombre,
        preferencias: await preferenciasDe(usuario.id, usuario.rol),
      },
      // Lo primero que pide la app: el aviso de días de prueba y los topes del plan.
      cuenta: await resumenCuenta(req.db),
    });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/auth/verificar-correo/enviar — manda (o reenvía) el código.
router.post('/verificar-correo/enviar', auth, async (req, res) => {
  try {
    const [[u]] = await req.db.query(
      'SELECT id, nombre, email, email_verificado FROM usuarios WHERE id = ? AND tenant_id = @tenant',
      [req.usuario.id]
    );
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (u.email_verificado) return res.json({ message: 'Tu correo ya está confirmado' });

    // Cada código cuesta un correo enviado: sin tope, el botón de reenviar es una
    // ametralladora gratis contra la reputación del dominio.
    const limite = consumir(`verif-staff:${u.id}`, { porMinuto: 1, porHora: 6 });
    if (!limite.ok) {
      return res.status(429).json({ error: `Esperá ${limite.retryAfter}s antes de pedir otro código.` });
    }

    const codigo = await nuevoCodigo(req.db, u.id);
    await enviarCodigoCorreoStaff(u.email, { nombre: u.nombre, codigo, minutos: VIGENCIA_MIN });
    res.json({ message: `Te mandamos un código a ${u.email}` });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/auth/verificar-correo — canjea el código.
router.post('/verificar-correo', auth, async (req, res) => {
  try {
    const motivo = await canjear(req.db, req.usuario.id, req.body?.codigo);
    if (motivo) return res.status(400).json({ error: motivo });
    res.json({ message: 'Correo confirmado' });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// Verificación en dos pasos (TOTP) — personal del taller
// Opt-in por cuenta. La contraseña deja de ser suficiente: hay que presentar
// además un código de 6 dígitos de la app de autenticación (o uno de respaldo).
// ───────────────────────────────────────────────────────────

// Canjea el token parcial del login por una sesión real, presentando el código.
// Público (el usuario todavía no tiene sesión), pero exige el token parcial.
router.post('/2fa/verificar', async (req, res) => {
  try {
    const { token_parcial, codigo } = req.body;
    if (!token_parcial || !codigo) return invalido(res, 'codigo', 'Falta el código');

    let datos;
    try {
      datos = jwt.verify(token_parcial, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'La sesión de ingreso venció. Iniciá sesión de nuevo.' });
    }
    if (!datos.pend2fa || !datos.id || !datos.tenant_id) {
      return res.status(401).json({ error: 'Token no válido' });
    }
    // Esta ruta no pasa por middleware/auth (todavía no hay sesión abierta), así que
    // el acceso scopeado se arma acá, con el taller que viaja en el token parcial.
    req.db = paraTenant(Number(datos.tenant_id));

    // Fuerza bruta: 6 dígitos son un millón de combinaciones, pero sin tope se
    // agotan rápido. Se limita por cuenta, no por IP (que el atacante puede rotar).
    const limite = consumir(`2fa:${datos.id}`, { porMinuto: 5, porHora: 20 });
    if (!limite.ok) {
      return res.status(429).json({ error: `Demasiados intentos. Esperá ${limite.retryAfter}s e intentá de nuevo.` });
    }

    const [[usuario]] = await pool.query(
      'SELECT id, nombre, email, rol, foto, permisos_web, totp_secret, totp_activado, totp_backup, totp_ultimo_contador FROM usuarios WHERE id = ? AND activo = 1',
      [datos.id]
    );
    if (!usuario || !usuario.totp_activado) return res.status(401).json({ error: 'Token no válido' });

    const ERR = 'Código incorrecto';
    const contador = totp.verificar(usuario.totp_secret, codigo, { ultimoContador: usuario.totp_ultimo_contador });

    if (contador) {
      // Guarda el período consumido: ese mismo código ya no se puede reusar.
      await req.db.query('UPDATE usuarios SET totp_ultimo_contador = ? WHERE id = ? AND tenant_id = @tenant', [contador, usuario.id]);
    } else {
      // ¿Será un código de respaldo? (un solo uso: si acierta, se elimina)
      const usado = await consumirCodigoRespaldo(req.db, usuario, codigo);
      if (!usado) {
        registrarEvento('dosfa_fallido', { email: usuario.email, ip: req.ip, usuarioId: usuario.id });
        return res.status(401).json({ error: ERR });
      }
    }

    // El SELECT de arriba no trae tenant_id: el taller sale del token parcial ya
    // verificado. Sin él la sesión recién abierta no serviría para nada (middleware/tenant
    // la corta con 401 en el primer pedido).
    const { payload, token } = await sesionStaff({ ...usuario, tenant_id: req.db.tenantId }, req);
    res.json({ data: { token, tipo: 'staff', usuario: { ...payload, permisos_web: normalizarPermisos(usuario.permisos_web), ...(await casillasDeSesion(usuario.id)), preferencias: await preferenciasDe(usuario.id, usuario.rol), foto: usuario.foto || null } } });
  } catch (err) {
    fail(res, err);
  }
});

// Busca el código entre los de respaldo del usuario. Si coincide, lo quema
// (lo saca de la lista) para que no sirva una segunda vez.
async function consumirCodigoRespaldo(db, usuario, codigo) {
  let hashes;
  try {
    hashes = JSON.parse(usuario.totp_backup || '[]');
  } catch {
    return false;
  }
  if (!Array.isArray(hashes) || !hashes.length) return false;
  const limpio = totp.normalizarRespaldo(codigo);
  if (!limpio) return false;
  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(limpio, hashes[i])) {
      hashes.splice(i, 1);
      await db.query('UPDATE usuarios SET totp_backup = ? WHERE id = ? AND tenant_id = @tenant', [JSON.stringify(hashes), usuario.id]);
      return true;
    }
  }
  return false;
}

// Estado del 2FA de mi cuenta (para pintar el panel del perfil).
router.get('/2fa/estado', auth, async (req, res) => {
  try {
    const [[u]] = await req.db.query('SELECT totp_activado, totp_backup FROM usuarios WHERE id = ? AND tenant_id = @tenant', [req.usuario.id]);
    let restantes = 0;
    try { restantes = (JSON.parse(u?.totp_backup || '[]') || []).length; } catch { restantes = 0; }
    res.json({ data: { activado: !!u?.totp_activado, backup_restantes: restantes } });
  } catch (err) {
    fail(res, err);
  }
});

// Paso 1 del alta: genera la clave y la devuelve para configurar la app.
// Queda guardada pero INACTIVA hasta que se confirme con un código válido.
router.post('/2fa/setup', auth, async (req, res) => {
  try {
    const [[u]] = await req.db.query('SELECT email, totp_activado FROM usuarios WHERE id = ? AND tenant_id = @tenant', [req.usuario.id]);
    if (u?.totp_activado) return res.status(400).json({ error: 'La verificación en dos pasos ya está activa' });

    const secreto = totp.generarSecreto();
    await req.db.query(
      'UPDATE usuarios SET totp_secret = ?, totp_activado = 0, totp_ultimo_contador = NULL WHERE id = ? AND tenant_id = @tenant',
      [secreto, req.usuario.id]
    );
    res.json({
      data: {
        secreto,
        secreto_legible: totp.secretoLegible(secreto),
        uri: totp.uriOtpauth(secreto, u.email || `usuario-${req.usuario.id}`, (await getConfig(req.db)).nombre_taller),
      },
    });
  } catch (err) {
    fail(res, err);
  }
});

// Paso 2 del alta: confirma que la app quedó bien configurada y activa el 2FA.
// Devuelve los códigos de respaldo — es la ÚNICA vez que se ven en texto plano.
router.post('/2fa/activar', auth, async (req, res) => {
  try {
    const { codigo } = req.body;
    if (!codigo) return invalido(res, 'codigo', 'Falta el código');

    const limite = consumir(`2fa-alta:${req.usuario.id}`, { porMinuto: 5, porHora: 30 });
    if (!limite.ok) {
      return res.status(429).json({ error: `Demasiados intentos. Esperá ${limite.retryAfter}s e intentá de nuevo.` });
    }

    const [[u]] = await req.db.query(
      'SELECT totp_secret, totp_activado FROM usuarios WHERE id = ? AND tenant_id = @tenant', [req.usuario.id]
    );
    if (u?.totp_activado) return res.status(400).json({ error: 'La verificación en dos pasos ya está activa' });
    if (!u?.totp_secret) return res.status(400).json({ error: 'Primero generá la clave' });

    const contador = totp.verificar(u.totp_secret, codigo);
    if (!contador) return invalido(res, 'codigo', 'El código no coincide. Revisá la hora del teléfono e intentá de nuevo.');

    const codigos = totp.generarCodigosRespaldo();
    const hashes = await Promise.all(codigos.map(c => bcrypt.hash(totp.normalizarRespaldo(c), 10)));
    await req.db.query(
      'UPDATE usuarios SET totp_activado = 1, totp_backup = ?, totp_ultimo_contador = ? WHERE id = ? AND tenant_id = @tenant',
      [JSON.stringify(hashes), contador, req.usuario.id]
    );

    anotar(req.usuario.id, 'dosfa_on');
    res.json({ data: { codigos_respaldo: codigos }, message: 'Verificación en dos pasos activada' });
  } catch (err) {
    fail(res, err);
  }
});

// Baja del 2FA. Debilita la cuenta, así que se exige la contraseña de nuevo
// (que quien tenga la sesión abierta en un equipo prestado no pueda apagarlo).
router.post('/2fa/desactivar', auth, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return invalido(res, 'password', 'Ingresá tu contraseña para desactivar');

    const limite = consumir(`2fa-baja:${req.usuario.id}`, { porMinuto: 5, porHora: 20 });
    if (!limite.ok) {
      return res.status(429).json({ error: `Demasiados intentos. Esperá ${limite.retryAfter}s e intentá de nuevo.` });
    }

    const [[u]] = await req.db.query('SELECT password_hash FROM usuarios WHERE id = ? AND tenant_id = @tenant', [req.usuario.id]);
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (!(await bcrypt.compare(String(password), u.password_hash))) {
      return invalido(res, 'password', 'La contraseña no es correcta');
    }

    await req.db.query(
      'UPDATE usuarios SET totp_activado = 0, totp_secret = NULL, totp_backup = NULL, totp_ultimo_contador = NULL WHERE id = ? AND tenant_id = @tenant',
      [req.usuario.id]
    );
    anotar(req.usuario.id, 'dosfa_off');
    registrarEvento('dosfa_desactivado', { ip: req.ip, usuarioId: req.usuario.id, actorId: req.usuario.id });
    res.json({ message: 'Verificación en dos pasos desactivada' });
  } catch (err) {
    fail(res, err);
  }
});

// ───────────────────────────────────────────────────────────
// Mi perfil del personal (los tres roles): preferencias, firma, sesiones y actividad.
// Van acá y no en cada panel porque son de la cuenta, sea cual sea el rol.
// ───────────────────────────────────────────────────────────

// Firma dibujada en el perfil: PNG en data URL, de tamaño razonable.
function firmaValida(f) {
  if (f === null) return true;
  return typeof f === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(f) && f.length <= 300 * 1024;
}

router.get('/perfil', auth, async (req, res) => {
  try {
    const [[u]] = await pool.query('SELECT telefono, firma FROM usuarios WHERE id = ?', [req.usuario.id]);
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({
      data: {
        telefono: u.telefono || '',
        firma: u.firma || null,
        preferencias: await preferenciasDe(req.usuario.id, req.usuario.rol),
        avisos: AVISOS[req.usuario.rol] || [],
        // Para orientar al elegir contraseña (la que manda es la del servidor).
        politica: politica(await getConfig(req.db)),
      },
    });
  } catch (err) {
    fail(res, err);
  }
});

router.put('/perfil/preferencias', auth, async (req, res) => {
  try {
    const prefs = normalizarPreferencias(req.body || {}, req.usuario.rol);
    if (prefs.sede_id) {
      const [[s]] = await pool.query('SELECT id FROM sucursales WHERE id = ?', [prefs.sede_id]);
      if (!s) prefs.sede_id = null;
    }
    await pool.query('UPDATE usuarios SET preferencias = ? WHERE id = ?', [JSON.stringify(prefs), req.usuario.id]);
    res.json({ data: prefs, message: 'Preferencias guardadas' });
  } catch (err) {
    fail(res, err);
  }
});

// Solo el teléfono (el panel no lo tenía en su cuenta; recepción y taller lo
// guardan con el resto de su perfil).
router.put('/perfil/telefono', auth, async (req, res) => {
  try {
    const tel = String(req.body?.telefono || '').trim();
    if (tel && !/^[0-9+()\-\s]{8,20}$/.test(tel)) return invalido(res, 'telefono', 'El teléfono no tiene un formato válido');
    await pool.query('UPDATE usuarios SET telefono = ? WHERE id = ?', [tel || null, req.usuario.id]);
    res.json({ data: { telefono: tel }, message: 'Teléfono guardado' });
  } catch (err) {
    fail(res, err);
  }
});

router.put('/perfil/firma', auth, async (req, res) => {
  try {
    const firma = req.body?.firma ?? null;
    if (!firmaValida(firma)) return invalido(res, 'firma', 'La firma no es una imagen válida');
    await pool.query('UPDATE usuarios SET firma = ? WHERE id = ?', [firma, req.usuario.id]);
    if (firma) anotar(req.usuario.id, 'firma');
    res.json({ data: { firma }, message: firma ? 'Firma guardada' : 'Firma borrada' });
  } catch (err) {
    fail(res, err);
  }
});

// Dónde tengo la sesión abierta.
router.get('/sesiones', auth, async (req, res) => {
  try {
    res.json({ data: { sesiones: await sesionesAbiertas(req.usuario.id, req.usuario.sid), con_sid: !!req.usuario.sid } });
  } catch (err) {
    fail(res, err);
  }
});

router.delete('/sesiones/:id', auth, async (req, res) => {
  try {
    const n = await cerrarSesionPropia(req.usuario.id, Number(req.params.id));
    if (!n) return res.status(404).json({ error: 'Esa sesión ya no está abierta' });
    anotar(req.usuario.id, 'sesion_cerrada');
    res.json({ message: 'Sesión cerrada' });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/sesiones/cerrar-otras', auth, async (req, res) => {
  try {
    const n = await cerrarOtrasSesiones(req.usuario.id, req.usuario.sid);
    if (n) anotar(req.usuario.id, 'sesiones_cerradas', `${n} sesi${n === 1 ? 'ón' : 'ones'}`);
    res.json({ data: { cerradas: n }, message: n ? `Listo: ${n} sesi${n === 1 ? 'ón cerrada' : 'ones cerradas'}` : 'No había otras sesiones abiertas' });
  } catch (err) {
    fail(res, err);
  }
});

// "Cerrar sesión": esta sesión deja de valer en el servidor, no solo en el equipo.
router.post('/salir', auth, async (req, res) => {
  try {
    await cerrarSid(req.usuario.sid);
    res.json({ message: 'Sesión cerrada' });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/actividad', auth, async (req, res) => {
  try {
    res.json({ data: await actividadDe(req.usuario.id) });
  } catch (err) {
    fail(res, err);
  }
});

// ── Recuperar la contraseña del PERSONAL ────────────────────────────────────────
//
// Hasta ahora no existía: el personal solo podía cambiarla con la sesión iniciada, y
// quien la olvidaba tenía que escribirle a Motiq. Es la misma mecánica que la de los
// clientes del portal (código de 6 dígitos con hash, 10 minutos, un solo uso, 5
// intentos, respuesta genérica), con dos diferencias:
//
//  · No exige taller. El login de motiq12.com resuelve al usuario por el correo, y el
//    mismo correo puede estar en varios talleres: se manda un código por cada cuenta
//    (cada uno con la marca de su taller) y al confirmar se cambia la de la cuenta
//    cuyo código coincide. Si llega `taller`, se acota a ese.
//  · No abre sesión al terminar: vuelve al login. Así la verificación en dos pasos, si
//    está activa, se sigue pidiendo; un reset de contraseña no la puede saltar.

const MSG_RESET = 'Si hay una cuenta con ese correo, te enviamos un código.';
const ERR_RESET = 'El código no es válido o ya venció. Pedí uno nuevo.';
const MAX_INTENTOS_RESET = 5;

// Las cuentas activas del personal con ese correo (acotadas a un taller si se pidió).
async function cuentasDelCorreo(email, taller) {
  const params = [String(email).trim().toLowerCase()];
  let filtro = '';
  if (taller) { filtro = ' AND t.slug = ?'; params.push(String(taller).trim().toLowerCase()); }
  const [filas] = await pool.query(
    `SELECT u.id, u.tenant_id, u.nombre, t.nombre AS taller_nombre, t.slug AS taller_slug
       FROM usuarios u JOIN tenants t ON t.id = u.tenant_id
      WHERE LOWER(u.email) = ? AND u.activo = 1 AND t.estado = 'activo'${filtro}`,
    params
  );
  return filas;
}

// POST /api/auth/recuperar/solicitar — manda el código (público, con antibot).
router.post('/recuperar/solicitar', antibot(), async (req, res) => {
  try {
    const { email, taller } = req.body || {};
    if (!emailValido(email)) return res.status(400).json({ error: 'El correo no tiene un formato válido' });

    const clave = String(email).trim().toLowerCase();
    const porCorreo = consumir(`reset-staff:${clave}`, { porMinuto: 1, porHora: 5 });
    const porIp = consumir(`reset-staff-ip:${req.ip}`, { porMinuto: 5, porHora: 30 });
    if (!porCorreo.ok || !porIp.ok) {
      const espera = Math.max(porCorreo.retryAfter || 0, porIp.retryAfter || 0);
      return res.status(429).json({ error: `Esperá ${espera}s antes de pedir otro código.` });
    }

    for (const c of await cuentasDelCorreo(email, taller)) {
      const db = paraTenant(c.tenant_id);
      const codigo = String(Math.floor(100000 + Math.random() * 900000));
      const codeHash = await bcrypt.hash(codigo, 10);
      // Invalida los anteriores: si conviven dos, se prueba el del correo viejo.
      await db.query(
        'UPDATE usuario_reset_codes SET used = 1 WHERE tenant_id = @tenant AND usuario_id = ? AND used = 0',
        [c.id]
      );
      await db.query(
        `INSERT INTO usuario_reset_codes (tenant_id, usuario_id, code_hash, expires_at)
         VALUES (@tenant, ?, ?, NOW() + INTERVAL '10 minutes')`,
        [c.id, codeHash]
      );
      await enviarCodigoReset(clave, c.nombre, codigo, { nombre: c.taller_nombre, slug: c.taller_slug });
    }

    // La misma respuesta exista o no la cuenta: no revela qué correos hay.
    res.json({ message: MSG_RESET });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/auth/recuperar/confirmar — canjea el código y fija la nueva contraseña.
router.post('/recuperar/confirmar', async (req, res) => {
  try {
    const { email, codigo, password, taller } = req.body || {};
    if (!emailValido(email)) return res.status(400).json({ error: 'El correo no tiene un formato válido' });
    if (!codigo || !password) return res.status(400).json({ error: 'Código y nueva contraseña son requeridos' });
    if (String(password).length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

    const limite = consumir(`reset-staff-conf:${String(email).trim().toLowerCase()}`, { porMinuto: 10, porHora: 30 });
    if (!limite.ok) return res.status(429).json({ error: `Demasiados intentos. Esperá ${limite.retryAfter}s.` });

    for (const c of await cuentasDelCorreo(email, taller)) {
      const db = paraTenant(c.tenant_id);
      const [[reg]] = await db.query(
        `SELECT id, code_hash, attempts FROM usuario_reset_codes
          WHERE tenant_id = @tenant AND usuario_id = ? AND used = 0 AND expires_at > NOW()
          ORDER BY id DESC LIMIT 1`,
        [c.id]
      );
      if (!reg || reg.attempts >= MAX_INTENTOS_RESET) continue;
      if (!(await bcrypt.compare(String(codigo).trim(), reg.code_hash))) {
        await db.query('UPDATE usuario_reset_codes SET attempts = attempts + 1 WHERE id = ? AND tenant_id = @tenant', [reg.id]);
        continue;
      }
      // El código llegó a esa casilla: de paso queda verificado el correo.
      const hash = await bcrypt.hash(String(password), 10);
      await db.query(
        'UPDATE usuarios SET password_hash = ?, email_verificado = 1 WHERE id = ? AND tenant_id = @tenant',
        [hash, c.id]
      );
      await db.query('UPDATE usuario_reset_codes SET used = 1 WHERE id = ? AND tenant_id = @tenant', [reg.id]);
      return res.json({ message: 'Listo, tu contraseña quedó cambiada. Ya podés entrar.' });
    }

    res.status(400).json({ error: ERR_RESET });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
