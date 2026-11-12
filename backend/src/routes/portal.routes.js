const router = require('express').Router();
const { normalizarTipos, puedeUsarTipo, catalogoDelTaller, limpiarAtributos } = require('../utils/tipos-vehiculo');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
// Sin `pool`: todo el acceso pasa por req.db, scopeado al taller.
const { fail, invalido, faltante } = require('../utils/responder');
const { registrarEvento } = require('../utils/eventos-seguridad');
const authCliente = require('../middleware/auth-cliente');
const tenantPublico = require('../middleware/tenant-publico');
const {
  emailValido, fotoValida, textoDentroDeLimite, cedulaValida, telefonoValido, anioValido, placaValida,
} = require('../utils/validar');

const MAX_MOTIVO = 1000;
const MAX_MOTIVO_RECHAZO = 1000;
const { consumir } = require('../utils/rate-limit');
const {
  enviarCodigoReset, enviarCodigoLogin, enviarCodigoVerificacion,
  enviarCodigoCambioCorreo, enviarAvisoCambioCorreo,
} = require('../services/mailer');
const { antibot } = require('../utils/antibot');
const { getServicios } = require('../utils/servicios');
const { serviciosDelPedido, problemaConServicios, textoServicios, guardarServiciosCita } = require('../utils/servicios-cita');
const { getConfig, horasDisponibles } = require('../utils/configuracion');
const { agendaDia, agendaRango, conflictosDeCita, horasPasadas } = require('../utils/agenda');
const { getSucursales, sucursalValida, sucursalPorDefecto } = require('../utils/sucursales');
const { avanzarEstadoOrden, registrarAprobacion, registrarRechazoAdicional } = require('../utils/ordenes');
const { recompensas } = require('../utils/recompensas');
const { problemaDeContrasena, PISO } = require('../utils/contrasena');
const { verificarIdToken, googleConfigurado } = require('../utils/google-id');
const { cerrarSesionesDeCliente, olvidarCliente } = require('../utils/sesiones');

// Fecha de hoy en zona del taller (offset configurable, por defecto UTC-6).
// Evita rechazar/permitir un día de más cuando el server corre en UTC.
async function hoyCR(db) {
  const config = await getConfig(db);
  const offset = Number(config.zona_horaria_offset) || -6;
  return new Date(Date.now() + offset * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// fotoValida (validación de imagen: tipo + tope ~4MB) vive en utils/validar.js,
// compartida por todo el backend. El cliente ya comprime antes de enviar; el tope
// solo evita abusos.
// Normaliza el valor recibido a lo que se guarda en la BD (string o NULL).
function fotoParaGuardar(foto) {
  return foto && String(foto).length ? foto : null;
}

// Horas (decimal) que faltan para el inicio de una cita; fecha 'YYYY-MM-DD' + hora
// 'HH:MM'. Ancla en zona de Costa Rica (UTC-6). Negativo si la cita ya pasó.
function horasHastaCita(fecha, hora) {
  const hhmm = String(hora || '00:00').slice(0, 5);
  const inicio = new Date(`${fecha}T${hhmm}:00-06:00`);
  return (inicio.getTime() - Date.now()) / 3600000;
}

// Código de 6 dígitos: el mismo generador criptográfico para todos los flujos.
const { codigoDeSeisDigitos } = require('../utils/verificacion-usuario');

// Firma el JWT del cliente y arma el payload estándar.
// El SELECT que trae a `cliente` TIENE que incluir tenant_id: sin él el token sale sin
// taller y middleware/tenant corta con 401 el primer pedido (pasó en tres flujos).
function tokenCliente(cliente) {
  if (!cliente.tenant_id) throw new Error('tokenCliente: el cliente no trae tenant_id');
  const payload = { id: cliente.id, tipo: 'cliente', nombre: cliente.nombre, apellido: cliente.apellido, tenant_id: cliente.tenant_id };
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
  return { payload, token };
}


// Identidad del taller para encabezar los correos: su nombre y su slug (que el
// endpoint publico del logo necesita para saber cual servir).
async function marcaDelTaller(db, slug) {
  try {
    const cfg = await getConfig(db);
    return { nombre: cfg.nombre_taller, slug: slug || null, color: cfg.color_primario || null };
  } catch { return {}; }
}

// GET /api/portal/google/config — el ID de cliente para el botón (no es secreto), o null.
//
// Va ANTES de tenantPublico a propósito: devuelve una variable de entorno del
// servidor, igual para todos los talleres, y no toca la base. Puesto después, el
// guard lo rechazaba con «Falta indicar el taller» y el login mostraba un aviso
// rojo al abrirse, sin que hubiera nada mal.
router.get('/google/config', (req, res) => {
  res.json({ data: { clientId: process.env.GOOGLE_CLIENT_ID || null } });
});

// Tramo publico (login, registro, recuperar, OTP): el taller sale del subdominio
// o de un campo `taller`, porque todavia no hay token del que leerlo.
router.use(tenantPublico);

// POST /api/portal/login — login del cliente con email + contraseña
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (faltante(res, req.body, [['email', 'el correo'], ['password', 'la contraseña']])) return;
    if (!emailValido(email)) return invalido(res, 'email', 'El correo no tiene un formato válido');
    // Sin mayúsculas ni espacios, igual que el login principal y la recuperación.
    const [[cliente]] = await req.db.query(
      'SELECT * FROM clientes WHERE tenant_id = @tenant AND LOWER(email) = ? AND activo = 1 ORDER BY id LIMIT 1',
      [String(email).trim().toLowerCase()]
    );
    if (!cliente || !cliente.password_hash) {
      registrarEvento('portal_login_fallido', { email, ip: req.ip, detalle: cliente ? 'sin contraseña' : 'cuenta inexistente' });
      return res.status(401).json({ error: 'Credenciales incorrectas o portal no habilitado' });
    }
    const ok = await bcrypt.compare(password, cliente.password_hash);
    if (!ok) {
      registrarEvento('portal_login_fallido', { email, ip: req.ip, detalle: 'contraseña incorrecta' });
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    // La contraseña ya se comprobó correcta (no hay riesgo de enumeración en avisar
    // esto acá): falta confirmar el correo antes de otorgar sesión.
    if (!cliente.email_verificado) {
      return res.status(403).json({ error: 'Confirma tu correo para entrar. Te enviamos un código al registrarte.', requiere_verificacion: true });
    }

    const { payload, token } = tokenCliente(cliente);
    // La foto va en la respuesta (para el avatar del header) pero NO en el JWT.
    res.json({ data: { token, cliente: { ...payload, foto: cliente.foto || null } } });
  } catch (err) {
    fail(res, err);
  }
});

// Genera, guarda y envía un código de verificación de correo (10 min, un solo uso).
// Invalida los códigos previos del cliente para que solo el último sea válido.
// El propósito separa dos códigos que conviven: el de estrenar la cuenta y el de mudar
// el correo desde el perfil. Sin distinguirlos, pedir uno anularía el otro.
async function nuevoCodigoVerificacion(db, clienteId, proposito) {
  const codigo = codigoDeSeisDigitos();
  const codeHash = await bcrypt.hash(codigo, 10);
  await db.query(
    'UPDATE email_verify_codes SET used = 1 WHERE tenant_id = @tenant AND cliente_id = ? AND proposito = ? AND used = 0',
    [clienteId, proposito]
  );
  await db.query(
    `INSERT INTO email_verify_codes (tenant_id, cliente_id, code_hash, proposito, expires_at)
     VALUES (@tenant, ?, ?, ?, (NOW() + INTERVAL '10 minutes'))`,
    [clienteId, codeHash, proposito]
  );
  return codigo;
}

async function enviarVerificacion(db, slug, clienteId, email, nombre) {
  const codigo = await nuevoCodigoVerificacion(db, clienteId, 'registro');
  await enviarCodigoVerificacion(email, nombre, codigo, await marcaDelTaller(db, slug));
}

// Código a la dirección NUEVA para confirmar un cambio de correo desde el perfil.
async function enviarCodigoCambio(db, slug, clienteId, emailNuevo, nombre) {
  const codigo = await nuevoCodigoVerificacion(db, clienteId, 'cambio');
  await enviarCodigoCambioCorreo(emailNuevo, nombre, codigo, await marcaDelTaller(db, slug));
}

// ¿Otra cuenta ya tiene ese correo, o lo tiene reservado como pendiente?
async function correoOcupado(db, email, exceptoId) {
  const [[dup]] = await db.query(
    'SELECT id FROM clientes WHERE tenant_id = @tenant AND (email = ? OR email_pendiente = ?) AND id <> ? AND activo = 1',
    [email, email, exceptoId]
  );
  return !!dup;
}

// ── Entrar con Google (solo clientes) ──
// El botón de Google (en el navegador) entrega un "ID token"; acá se comprueba con
// utils/google-id.js. Quien ya tiene cuenta (por la cuenta de Google o por el mismo
// correo) entra directo; quien no, completa teléfono y cédula en /google/completar.
// Sin GOOGLE_CLIENT_ID no hay botón y estas rutas responden que no está activo.
const GOOGLE_NO_ACTIVO = 'El ingreso con Google no está activado.';
const ERR_GOOGLE = 'No se pudo comprobar tu cuenta de Google. Intenta de nuevo.';

// Entra con la cuenta que ya existe: la une a la cuenta de Google si todavía no lo
// estaba y da el correo por verificado (Google ya lo verificó).
//
// Si la cuenta todavía no estaba verificada, su contraseña es una PENDIENTE: la pudo
// poner cualquiera que supiera el correo, en /registro, esperando justo esto. Darla por
// buena al entrar con Google le dejaría la cuenta a esa persona, así que se borra; el
// dueño entra con Google y, si quiere una contraseña, la crea desde «¿Olvidaste tu
// contraseña?». Es el mismo cuidado que tiene el ingreso con código (/otp/verificar).
async function unirConGoogle(db, cliente, sub) {
  await db.query(
    `UPDATE clientes
        SET google_sub = ?, email_verificado = 1,
            password_hash = CASE WHEN email_verificado = 0 THEN NULL ELSE password_hash END
      WHERE tenant_id = @tenant AND id = ?`,
    [sub, cliente.id]
  );
}

async function entrarConGoogle(req, res, cliente, g) {
  if (!cliente.google_sub) await unirConGoogle(req.db, cliente, g.sub);
  const { payload, token } = tokenCliente(cliente);
  res.json({ data: { token, cliente: { ...payload, foto: cliente.foto || null } } });
}

// Busca la cuenta del cliente: primero por la cuenta de Google, después por el correo.
// Si el correo ya está unido a OTRA cuenta de Google, no se toca.
async function clienteDeGoogle(req, g) {
  const [[porSub]] = await req.db.query('SELECT * FROM clientes WHERE tenant_id = @tenant AND google_sub = ? AND activo = 1', [g.sub]);
  if (porSub) return { cliente: porSub };
  const [[porCorreo]] = await req.db.query('SELECT * FROM clientes WHERE tenant_id = @tenant AND email = ? AND activo = 1 ORDER BY id LIMIT 1', [g.email]);
  if (porCorreo && porCorreo.google_sub && porCorreo.google_sub !== g.sub) return { conflicto: true };
  return { cliente: porCorreo || null };
}

// POST /api/portal/google — { credential } del botón de Google.
router.post('/google', async (req, res) => {
  try {
    if (!googleConfigurado()) return res.status(404).json({ error: GOOGLE_NO_ACTIVO });
    const limite = consumir(`google:${req.ip}`, { porMinuto: 10, porHora: 60 });
    if (!limite.ok) return res.status(429).json({ error: `Demasiados intentos. Espera ${limite.retryAfter}s e intenta de nuevo.` });

    let g;
    try { g = await verificarIdToken(req.body?.credential); } catch { return res.status(401).json({ error: ERR_GOOGLE }); }

    const { cliente, conflicto } = await clienteDeGoogle(req, g);
    if (conflicto) return res.status(409).json({ error: 'Ese correo ya está unido a otra cuenta de Google. Entra con tu correo y contraseña.' });
    if (cliente) return entrarConGoogle(req, res, cliente, g);

    // Cuenta nueva: faltan teléfono y cédula. Se devuelve un pase corto (15 min) con
    // lo que ya dio Google, para no tener que volver a pedir el token.
    const pase = jwt.sign({ tipo: 'google-alta', sub: g.sub, email: g.email, nombre: g.nombre, apellido: g.apellido },
      process.env.JWT_SECRET, { expiresIn: '15m' });
    res.json({ data: { requiere_datos: true, pase_google: pase, email: g.email, nombre: g.nombre, apellido: g.apellido } });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/portal/google/completar — { pase_google, nombre, apellido, telefono, cedula }.
// Crea la cuenta sin contraseña (entra con Google; si después quiere una, la crea en
// "¿Olvidaste tu contraseña?") y abre la sesión.
router.post('/google/completar', async (req, res) => {
  try {
    if (!googleConfigurado()) return res.status(404).json({ error: GOOGLE_NO_ACTIVO });
    let pase;
    try {
      pase = jwt.verify(String(req.body?.pase_google || ''), process.env.JWT_SECRET, { algorithms: ['HS256'] });
      if (pase.tipo !== 'google-alta') throw new Error('pase de otro tipo');
    } catch {
      return res.status(401).json({ error: 'Se venció el ingreso con Google. Vuelve a tocar "Continuar con Google".' });
    }

    const nombre = String(req.body?.nombre || pase.nombre || '').trim();
    const apellido = String(req.body?.apellido || pase.apellido || '').trim();
    const { telefono, cedula } = req.body || {};
    if (faltante(res, { nombre, apellido, telefono, cedula }, [['nombre', 'el nombre'], ['apellido', 'el apellido'], ['telefono', 'el teléfono'], ['cedula', 'la cédula']])) return;
    if (!telefonoValido(telefono)) return invalido(res, 'telefono', 'El teléfono no tiene un formato válido');
    if (!cedulaValida(cedula)) return invalido(res, 'cedula', 'La cédula no tiene un formato válido');

    // Entre el primer paso y este pudo haberse creado la cuenta (otra pestaña).
    const g = { sub: pase.sub, email: pase.email };
    const { cliente, conflicto } = await clienteDeGoogle(req, g);
    if (conflicto) return res.status(409).json({ error: 'Ese correo ya está unido a otra cuenta de Google. Entra con tu correo y contraseña.' });
    if (cliente) return entrarConGoogle(req, res, cliente, g);

    const [r] = await req.db.query(
      'INSERT INTO clientes (tenant_id, nombre, apellido, telefono, email, cedula, password_hash, email_verificado, google_sub) VALUES (@tenant, ?, ?, ?, ?, ?, NULL, 1, ?)',
      [nombre, apellido, String(telefono).trim(), pase.email, String(cedula).trim(), pase.sub]
    );
    const [[nuevo]] = await req.db.query('SELECT * FROM clientes WHERE tenant_id = @tenant AND id = ?', [r.insertId]);
    const { payload, token } = tokenCliente(nuevo);
    res.status(201).json({ data: { token, cliente: { ...payload, foto: null } } });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/portal/registro — auto-registro del cliente (público). NO abre sesión:
// crea la cuenta sin verificar y manda un código de 6 dígitos al correo. La sesión
// se otorga recién en /registro/verificar, cuando se prueba que se controla ese correo
// (cierra el hueco de bots que se registraban en masa con emails inventados).
router.post('/registro', antibot(), async (req, res) => {
  try {
    const { nombre, apellido, telefono, email, cedula, password } = req.body;
    if (faltante(res, req.body, [['nombre', 'el nombre'], ['apellido', 'el apellido'], ['telefono', 'el teléfono'], ['email', 'el correo'], ['cedula', 'la cédula'], ['password', 'la contraseña']])) return;
    if (!emailValido(email)) return invalido(res, 'email', 'El correo no tiene un formato válido');
    const malaClave = problemaDeContrasena(password, PISO, { email, nombre });
    if (malaClave) return invalido(res, 'password', malaClave);
    if (!telefonoValido(telefono)) return invalido(res, 'telefono', 'El teléfono no tiene un formato válido');
    if (!cedulaValida(cedula)) return invalido(res, 'cedula', 'La cédula no tiene un formato válido');

    // Rate-limit por correo: frena el sondeo de cuentas existentes vía el 409 de abajo.
    const limite = consumir(`registro:${String(email).trim().toLowerCase()}`, { porMinuto: 3, porHora: 20 });
    if (!limite.ok) {
      return res.status(429).json({ error: `Demasiados intentos. Espera ${limite.retryAfter}s e intenta de nuevo.` });
    }

    const [[existente]] = await req.db.query('SELECT id, password_hash FROM clientes WHERE tenant_id = @tenant AND email = ? AND activo = 1', [email]);
    const hash = await bcrypt.hash(password, 10);
    let clienteId;

    if (existente) {
      if (existente.password_hash) {
        return invalido(res, 'email', 'Ese correo ya tiene una cuenta. Inicia sesión.', 409);
      }
      // El taller ya tenía registrado al cliente: "reclama" la cuenta definiendo su
      // contraseña. Igual exige verificar el correo — sin esto, cualquiera que supiera
      // el email de un cliente ya cargado por el taller podía apropiarse de su cuenta.
      await req.db.query(
        'UPDATE clientes SET password_hash = ?, cedula = COALESCE(cedula, ?), email_verificado = 0 WHERE id = ? AND tenant_id = @tenant',
        [hash, cedula || null, existente.id]
      );
      clienteId = existente.id;
    } else {
      const [result] = await req.db.query(
        'INSERT INTO clientes (tenant_id, nombre, apellido, telefono, email, cedula, password_hash, email_verificado) VALUES (@tenant, ?, ?, ?, ?, ?, ?, 0)',
        [nombre, apellido, telefono, email, cedula || null, hash]
      );
      clienteId = result.insertId;
    }

    await enviarVerificacion(req.db, req.tallerSlug, clienteId, email, nombre);
    res.status(201).json({ data: { requiere_verificacion: true, email }, message: 'Te enviamos un código para confirmar tu correo.' });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/portal/registro/verificar — confirma el código y recién ahí otorga sesión.
router.post('/registro/verificar', async (req, res) => {
  try {
    const { email, codigo } = req.body;
    if (!emailValido(email)) return invalido(res, 'email', 'El correo no tiene un formato válido');
    if (!codigo) return invalido(res, 'codigo', 'Falta el código');

    const [[cliente]] = await req.db.query(
      'SELECT id, tenant_id, nombre, apellido, email_verificado FROM clientes WHERE tenant_id = @tenant AND email = ? AND activo = 1', [email]
    );
    const ERR_CODIGO = 'Código inválido o expirado';
    if (!cliente) return invalido(res, 'codigo', ERR_CODIGO);

    // Ya verificado: NO se entrega sesión. Antes esto devolvía un token sin mirar el
    // código ("idempotente" ante un doble clic), y como los clientes que carga el taller
    // nacen con email_verificado = 1, alcanzaba con saber el correo de cualquiera de
    // ellos para entrar a su cuenta. Si ya está confirmado, que inicie sesión.
    if (cliente.email_verificado) {
      return res.status(409).json({ error: 'Tu correo ya está confirmado. Iniciá sesión.', ya_verificado: true });
    }

    const limite = consumir(`registro-verificar:${String(email).trim().toLowerCase()}`, { porMinuto: 5, porHora: 20 });
    if (!limite.ok) {
      return res.status(429).json({ error: `Demasiados intentos. Espera ${limite.retryAfter}s e intenta de nuevo.` });
    }

    const [[reg]] = await req.db.query(
      `SELECT id, code_hash, attempts FROM email_verify_codes
       WHERE tenant_id = @tenant AND cliente_id = ? AND proposito = 'registro' AND used = 0 AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [cliente.id]
    );
    if (!reg || reg.attempts >= 5) return invalido(res, 'codigo', ERR_CODIGO);

    const ok = await bcrypt.compare(String(codigo).trim(), reg.code_hash);
    if (!ok) {
      await req.db.query('UPDATE email_verify_codes SET attempts = attempts + 1 WHERE tenant_id = @tenant AND id = ?', [reg.id]);
      return invalido(res, 'codigo', ERR_CODIGO);
    }

    await req.db.query('UPDATE email_verify_codes SET used = 1 WHERE id = ? AND tenant_id = @tenant', [reg.id]);
    await req.db.query('UPDATE clientes SET email_verificado = 1 WHERE id = ? AND tenant_id = @tenant', [cliente.id]);

    const { payload, token } = tokenCliente(cliente);
    res.json({ data: { token, cliente: payload } });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/portal/registro/reenviar — pide un código nuevo (p. ej. si no llegó o venció).
// Respuesta genérica (anti-enumeración) y protegido con el mismo honeypot/captcha que
// el registro, para que no sirva como vector de bombardeo de correos.
router.post('/registro/reenviar', antibot(), async (req, res) => {
  try {
    const { email } = req.body;
    if (!emailValido(email)) return invalido(res, 'email', 'El correo no tiene un formato válido');

    const limite = consumir(`registro-reenviar:${String(email).trim().toLowerCase()}`, { porMinuto: 1, porHora: 5 });
    if (!limite.ok) {
      return res.status(429).json({ error: `Espera ${limite.retryAfter}s antes de pedir otro código.` });
    }

    const [[cliente]] = await req.db.query(
      'SELECT id, nombre FROM clientes WHERE tenant_id = @tenant AND email = ? AND activo = 1 AND email_verificado = 0', [email]
    );
    if (cliente) await enviarVerificacion(req.db, req.tallerSlug, cliente.id, email, cliente.nombre);

    res.json({ message: 'Si tu cuenta está pendiente de verificar, te enviamos un nuevo código.' });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/portal/recuperar/solicitar — envía un código de 6 dígitos al correo (público)
// Respuesta genérica siempre (anti-enumeración de cuentas).
const MSG_GENERICO = 'Si la cuenta existe, te enviamos un código a tu correo.';
router.post('/recuperar/solicitar', antibot(), async (req, res) => {
  try {
    const { email } = req.body;
    if (!emailValido(email)) return invalido(res, 'email', 'El correo no tiene un formato válido');

    const clave = String(email).trim().toLowerCase();
    const limite = consumir(`reset:${clave}`, { porMinuto: 1, porHora: 5 });
    if (!limite.ok) {
      return res.status(429).json({ error: `Espera ${limite.retryAfter}s antes de pedir otro código.` });
    }
    registrarEvento('recuperacion_pedida', { email, ip: req.ip });

    const [[cliente]] = await req.db.query(
      // También quien entró solo con Google: así se crea una contraseña.
      'SELECT id, nombre, apellido FROM clientes WHERE tenant_id = @tenant AND email = ? AND activo = 1 AND (password_hash IS NOT NULL OR google_sub IS NOT NULL)',
      [email]
    );

    if (cliente) {
      const codigo = codigoDeSeisDigitos();
      const codeHash = await bcrypt.hash(codigo, 10);
      // Invalida códigos previos y guarda el nuevo (vence en 10 min).
      await req.db.query('UPDATE password_reset_codes SET used = 1 WHERE tenant_id = @tenant AND cliente_id = ? AND used = 0', [cliente.id]);
      await req.db.query(
        "INSERT INTO password_reset_codes (tenant_id, cliente_id, code_hash, expires_at) VALUES (@tenant, ?, ?, NOW() + INTERVAL '10 minutes')",
        [cliente.id, codeHash]
      );
      await enviarCodigoReset(email, cliente.nombre, codigo, await marcaDelTaller(req.db, req.tallerSlug));
    }

    res.json({ message: MSG_GENERICO });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/portal/recuperar/confirmar — valida el código y define la nueva contraseña (público)
router.post('/recuperar/confirmar', async (req, res) => {
  try {
    const { email, codigo, password } = req.body;
    if (!emailValido(email)) return invalido(res, 'email', 'El correo no tiene un formato válido');
    if (faltante(res, req.body, [['codigo', 'el código'], ['password', 'la nueva contraseña']])) return;
    const malaClave = problemaDeContrasena(password, PISO, { email });
    if (malaClave) return invalido(res, 'password', malaClave);

    const [[cliente]] = await req.db.query(
      'SELECT id, tenant_id, nombre, apellido FROM clientes WHERE tenant_id = @tenant AND email = ? AND activo = 1 AND (password_hash IS NOT NULL OR google_sub IS NOT NULL)',
      [email]
    );
    const ERR_CODIGO = 'Código inválido o expirado';
    if (!cliente) return invalido(res, 'codigo', ERR_CODIGO);

    const [[reg]] = await req.db.query(
      `SELECT id, code_hash, attempts FROM password_reset_codes
       WHERE tenant_id = @tenant AND cliente_id = ? AND used = 0 AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [cliente.id]
    );
    if (!reg || reg.attempts >= 5) return invalido(res, 'codigo', ERR_CODIGO);

    const ok = await bcrypt.compare(String(codigo).trim(), reg.code_hash);
    if (!ok) {
      await req.db.query('UPDATE password_reset_codes SET attempts = attempts + 1 WHERE tenant_id = @tenant AND id = ?', [reg.id]);
      return invalido(res, 'codigo', ERR_CODIGO);
    }

    // Completar el reset por correo prueba que se controla la bandeja: de paso
    // verifica la cuenta (cierra el reset como atajo para "reclamar" sin verificar).
    const hash = await bcrypt.hash(password, 10);
    await req.db.query('UPDATE clientes SET password_hash = ?, email_verificado = 1 WHERE id = ? AND tenant_id = @tenant', [hash, cliente.id]);
    await req.db.query('UPDATE password_reset_codes SET used = 1 WHERE id = ? AND tenant_id = @tenant', [reg.id]);
    // Salen todas las sesiones anteriores; la que se abre abajo es posterior y vale.
    await cerrarSesionesDeCliente(cliente.id);

    const { payload, token } = tokenCliente(cliente);
    res.json({ data: { token, cliente: payload } });
  } catch (err) {
    fail(res, err);
  }
});

// ── Ingreso sin contraseña (OTP por correo) ──────────────────────────────
// A diferencia del reset, NO exige password_hash: sirve para que cualquier cliente
// que el taller ya tenga registrado entre con un código enviado a su correo, sin
// haberse creado nunca una contraseña. Mismas garantías: hash, expiración 10 min,
// máx 5 intentos, un solo uso, respuesta genérica (anti-enumeración) y rate limit.
const MSG_OTP_GENERICO = 'Si tu correo está registrado, te enviamos un código de ingreso.';
router.post('/otp/solicitar', antibot(), async (req, res) => {
  try {
    const { email } = req.body;
    if (!emailValido(email)) return invalido(res, 'email', 'El correo no tiene un formato válido');

    const clave = String(email).trim().toLowerCase();
    const limite = consumir(`otp:${clave}`, { porMinuto: 1, porHora: 5 });
    if (!limite.ok) {
      return res.status(429).json({ error: `Espera ${limite.retryAfter}s antes de pedir otro código.` });
    }

    const [[cliente]] = await req.db.query(
      'SELECT id, nombre FROM clientes WHERE tenant_id = @tenant AND email = ? AND activo = 1',
      [email]
    );
    if (cliente) {
      const codigo = codigoDeSeisDigitos();
      const codeHash = await bcrypt.hash(codigo, 10);
      // Invalida códigos previos y guarda el nuevo (vence en 10 min).
      await req.db.query('UPDATE login_codes SET used = 1 WHERE tenant_id = @tenant AND cliente_id = ? AND used = 0', [cliente.id]);
      await req.db.query(
        "INSERT INTO login_codes (tenant_id, cliente_id, code_hash, expires_at) VALUES (@tenant, ?, ?, NOW() + INTERVAL '10 minutes')",
        [cliente.id, codeHash]
      );
      await enviarCodigoLogin(email, cliente.nombre, codigo, await marcaDelTaller(req.db, req.tallerSlug));
    }

    res.json({ message: MSG_OTP_GENERICO });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/portal/otp/verificar — valida el código y entra (auto-login). Público.
router.post('/otp/verificar', async (req, res) => {
  try {
    const { email, codigo } = req.body;
    if (!emailValido(email)) return invalido(res, 'email', 'El correo no tiene un formato válido');
    if (!codigo) return invalido(res, 'codigo', 'Falta el código');

    const [[cliente]] = await req.db.query(
      'SELECT id, tenant_id, nombre, apellido, foto FROM clientes WHERE tenant_id = @tenant AND email = ? AND activo = 1',
      [email]
    );
    const ERR_CODIGO = 'Código inválido o expirado';
    if (!cliente) return invalido(res, 'codigo', ERR_CODIGO);

    const [[reg]] = await req.db.query(
      `SELECT id, code_hash, attempts FROM login_codes
       WHERE tenant_id = @tenant AND cliente_id = ? AND used = 0 AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [cliente.id]
    );
    if (!reg || reg.attempts >= 5) return invalido(res, 'codigo', ERR_CODIGO);

    const ok = await bcrypt.compare(String(codigo).trim(), reg.code_hash);
    if (!ok) {
      await req.db.query('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ? AND tenant_id = @tenant', [reg.id]);
      return invalido(res, 'codigo', ERR_CODIGO);
    }

    await req.db.query('UPDATE login_codes SET used = 1 WHERE id = ? AND tenant_id = @tenant', [reg.id]);
    // Entrar con el código prueba que se controla la bandeja, pero NO que la contraseña
    // pendiente sea de quien entra: pudo ponerla otro "reclamando" la cuenta en
    // /registro. Promover ahí la volvería válida y le daría la cuenta a ese otro. Por
    // eso solo se promueven las cuentas sin contraseña; la que tiene una pendiente
    // sigue entrando por código y se confirma con el código de /registro/verificar.
    await req.db.query(
      'UPDATE clientes SET email_verificado = 1 WHERE tenant_id = @tenant AND id = ? AND email_verificado = 0 AND password_hash IS NULL',
      [cliente.id]
    );
    const { payload, token } = tokenCliente(cliente);
    res.json({ data: { token, cliente: { ...payload, foto: cliente.foto || null } } });
  } catch (err) {
    fail(res, err);
  }
});

// Todo lo de abajo requiere token de cliente
router.use(authCliente);

// GET /api/portal/resumen — métricas del inicio del cliente
router.get('/resumen', async (req, res) => {
  try {
    const id = req.cliente.id;
    // "Citas totales" del cliente = pendientes + completadas (NO cuenta las canceladas,
    // que para el cliente quedan eliminadas de su vista).
    const [[{ citas_totales }]] = await req.db.query(
      "SELECT COUNT(*) AS citas_totales FROM citas WHERE tenant_id = @tenant AND cliente_id = ? AND estado <> 'cancelado'",
      [id]
    );
    const [[{ citas_pendientes }]] = await req.db.query(
      "SELECT COUNT(*) AS citas_pendientes FROM citas WHERE tenant_id = @tenant AND cliente_id = ? AND estado NOT IN ('entregado','cancelado')",
      [id]
    );
    const [[{ motos_registradas }]] = await req.db.query('SELECT COUNT(*) AS motos_registradas FROM vehiculos WHERE tenant_id = @tenant AND cliente_id = ? AND activa = 1', [id]);
    // Total pagado y visitas completadas: una sola fuente que cruza los dos mundos
    // sin doble conteo. Cuenta citas entregadas (su monto ya = total de la orden
    // vinculada al entregar) + órdenes entregadas SIN cita (visitas sin agenda previa).
    const [[{ total_pagado }]] = await req.db.query(
      `SELECT
         (SELECT COALESCE(SUM(monto), 0) FROM citas WHERE tenant_id = @tenant AND cliente_id = ? AND estado = 'entregado')
       + (SELECT COALESCE(SUM(costo_mano_obra + costo_repuestos - descuento), 0)
            FROM ordenes_trabajo
            WHERE tenant_id = @tenant AND cliente_id = ? AND estado = 'entregada'
              AND id NOT IN (SELECT orden_id FROM citas WHERE tenant_id = @tenant AND orden_id IS NOT NULL)) AS total_pagado`,
      [id, id]
    );
    const [[{ completadas }]] = await req.db.query(
      `SELECT
         (SELECT COUNT(*) FROM citas WHERE tenant_id = @tenant AND cliente_id = ? AND estado = 'entregado')
       + (SELECT COUNT(*) FROM ordenes_trabajo
            WHERE tenant_id = @tenant AND cliente_id = ? AND estado = 'entregada'
              AND id NOT IN (SELECT orden_id FROM citas WHERE tenant_id = @tenant AND orden_id IS NOT NULL)) AS completadas`,
      [id, id]
    );
    // Cita destacada del inicio. Antes se tomaba la cita no-terminal más antigua,
    // lo que mostraba citas ya vencidas (o en curso) bajo el título "Próxima cita".
    // Ahora clasificamos y elegimos por prioridad:
    //   1) en_curso  → la moto ya está en el taller (estado != 'agendado').
    //   2) proxima   → agendada para hoy o más adelante.
    //   3) vencida   → agendada pero la fecha ya pasó y nunca se inició.
    const hoy = await hoyCR(req.db);
    const [citasAbiertas] = await req.db.query(
      `SELECT ci.id, to_char(ci.fecha, 'YYYY-MM-DD') AS fecha, to_char(ci.hora, 'HH24:MI') AS hora,
              ci.tipo_servicio, ci.servicios, ci.estado,
              m.marca, m.modelo, m.placa, t.nombre AS tecnico_nombre
       FROM citas ci
       LEFT JOIN vehiculos m ON m.id = ci.vehiculo_id AND m.tenant_id = @tenant
       LEFT JOIN usuarios t ON t.id = ci.tecnico_id AND t.tenant_id = @tenant
       WHERE ci.tenant_id = @tenant AND ci.cliente_id = ? AND ci.estado NOT IN ('entregado','cancelado')
       ORDER BY ci.fecha ASC, ci.hora ASC`,
      [id]
    );

    const enCurso = citasAbiertas.filter(c => c.estado !== 'agendado');
    const futuras = citasAbiertas.filter(c => c.estado === 'agendado' && c.fecha >= hoy);
    const vencidas = citasAbiertas.filter(c => c.estado === 'agendado' && c.fecha < hoy);

    let proxima_cita = null;
    if (enCurso.length) {
      // La que entró más recientemente al taller (última por fecha/hora).
      proxima_cita = { ...enCurso[enCurso.length - 1], tipo: 'en_curso' };
    } else if (futuras.length) {
      proxima_cita = { ...futuras[0], tipo: 'proxima' };
    } else if (vencidas.length) {
      // La vencida más reciente, para invitar a reagendar.
      proxima_cita = { ...vencidas[vencidas.length - 1], tipo: 'vencida' };
    }

    res.json({
      data: {
        citas_totales, citas_pendientes, motos_registradas, total_pagado,
        recompensas: recompensas(completadas),
        proxima_cita,
      },
    });
  } catch (err) {
    fail(res, err);
  }
});

// Días que se conserva una notificación ya leída antes de auto-purgarse.
const NOTIF_RETENCION_DIAS = 7;

// GET /api/portal/notificaciones — feed de avances del cliente.
// Antes de devolver, purga las que ya fueron leídas hace más de N días (la
// info real vive en el detalle de la cita; el feed no debe crecer sin límite).
router.get('/notificaciones', async (req, res) => {
  try {
    await req.db.query(
      "DELETE FROM notificaciones WHERE tenant_id = @tenant AND cliente_id = ? AND leida = 1 AND created_at < NOW() - ?::int * INTERVAL '1 day'",
      [req.cliente.id, NOTIF_RETENCION_DIAS]
    );
    const [rows] = await req.db.query(
      'SELECT id, cita_id, titulo, mensaje, tipo, leida, created_at FROM notificaciones WHERE tenant_id = @tenant AND cliente_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.cliente.id]
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/portal/notificaciones/contador — solo el # de no leídas (para el badge).
router.get('/notificaciones/contador', async (req, res) => {
  try {
    const [[{ no_leidas }]] = await req.db.query(
      'SELECT COUNT(*) AS no_leidas FROM notificaciones WHERE tenant_id = @tenant AND cliente_id = ? AND leida = 0',
      [req.cliente.id]
    );
    res.json({ data: { no_leidas } });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/portal/notificaciones/leer — marca todas como leídas
router.post('/notificaciones/leer', async (req, res) => {
  try {
    await req.db.query('UPDATE notificaciones SET leida = 1 WHERE tenant_id = @tenant AND cliente_id = ? AND leida = 0', [req.cliente.id]);
    res.json({ message: 'Notificaciones leídas' });
  } catch (err) {
    fail(res, err);
  }
});

// PATCH /api/portal/notificaciones/:id/leer — marca UNA como leída.
router.patch('/notificaciones/:id/leer', async (req, res) => {
  try {
    await req.db.query(
      'UPDATE notificaciones SET leida = 1 WHERE tenant_id = @tenant AND id = ? AND cliente_id = ?',
      [req.params.id, req.cliente.id]
    );
    res.json({ message: 'Notificación leída' });
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /api/portal/notificaciones/leidas — borra todas las leídas (limpiar feed).
router.delete('/notificaciones/leidas', async (req, res) => {
  try {
    await req.db.query('DELETE FROM notificaciones WHERE tenant_id = @tenant AND cliente_id = ? AND leida = 1', [req.cliente.id]);
    res.json({ message: 'Notificaciones leídas eliminadas' });
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /api/portal/notificaciones/:id — borra UNA (deslizar para eliminar).
router.delete('/notificaciones/:id', async (req, res) => {
  try {
    await req.db.query(
      'DELETE FROM notificaciones WHERE tenant_id = @tenant AND id = ? AND cliente_id = ?',
      [req.params.id, req.cliente.id]
    );
    res.json({ message: 'Notificación eliminada' });
  } catch (err) {
    fail(res, err);
  }
});

// ——— Perfil del cliente (Mi cuenta + Seguridad) ———

// GET /api/portal/perfil — datos de la cuenta del cliente autenticado
router.get('/perfil', async (req, res) => {
  try {
    const [[c]] = await req.db.query(
      `SELECT id, nombre, apellido, email, email_pendiente, telefono, cedula, foto,
              notif_avances, notif_recordatorios,
              (password_hash IS NOT NULL)::int AS tiene_password, (google_sub IS NOT NULL)::int AS con_google
       FROM clientes WHERE tenant_id = @tenant AND id = ? AND activo = 1`,
      [req.cliente.id]
    );
    if (!c) return res.status(404).json({ error: 'Cuenta no encontrada' });
    res.json({ data: c });
  } catch (err) {
    fail(res, err);
  }
});

// PUT /api/portal/perfil — el cliente edita sus datos de contacto
router.put('/perfil', async (req, res) => {
  try {
    const { nombre, apellido, telefono, email } = req.body;
    if (faltante(res, req.body, [['nombre', 'el nombre'], ['apellido', 'el apellido']])) return;
    if (!email || !emailValido(email)) {
      return invalido(res, 'email', 'El correo no tiene un formato válido');
    }
    // Obligatorio igual que en el registro: es la vía por la que el taller avisa que
    // la moto está lista. Antes se podía vaciar desde el perfil y quedaba una cuenta
    // sin teléfono aunque al registrarse hubiera sido requerido.
    if (!telefono || !String(telefono).trim()) {
      return invalido(res, 'telefono', 'Falta el teléfono');
    }
    if (!telefonoValido(telefono)) {
      return invalido(res, 'telefono', 'El teléfono no tiene un formato válido');
    }
    const [[actual]] = await req.db.query(
      'SELECT nombre, email, password_hash FROM clientes WHERE id = ? AND tenant_id = @tenant', [req.cliente.id]
    );
    if (!actual) return res.status(404).json({ error: 'Cuenta no encontrada' });

    const emailNuevo = email.trim();
    const cambiaCorreo = emailNuevo.toLowerCase() !== String(actual.email || '').toLowerCase();

    // El correo es harina de otro costal: es con lo que se entra y con lo que se
    // recupera la contraseña. Cambiarlo de una sola pasada convertía una sesión robada
    // en un robo definitivo de la cuenta (el ladrón se lleva los códigos de
    // recuperación y el dueño ya no puede volver). Por eso van dos candados:
    //   1. hay que saber la contraseña actual, que un token robado no da;
    //   2. la dirección nueva queda PENDIENTE hasta confirmarse con un código.
    // Mientras tanto la cuenta sigue funcionando con el correo viejo, así que un
    // error de tipeo no encierra a nadie afuera.
    if (cambiaCorreo) {
      const { password } = req.body;
      if (!password) {
        return res.status(400).json({ error: 'Para cambiar el correo, escribe tu contraseña actual', requiere_password: true });
      }
      if (!actual.password_hash || !(await bcrypt.compare(password, actual.password_hash))) {
        return res.status(401).json({ error: 'La contraseña actual no es correcta' });
      }

      const limite = consumir(`cambio-correo:${req.cliente.id}`, { porMinuto: 2, porHora: 10 });
      if (!limite.ok) {
        return res.status(429).json({ error: `Demasiados intentos. Espera ${limite.retryAfter}s e intenta de nuevo.` });
      }

      // No puede pisar la cuenta de otro, ni el correo ya en uso ni uno que otro tenga
      // reservado como pendiente (se vuelve a comprobar al confirmar, por si acaso).
      if (await correoOcupado(req.db, emailNuevo, req.cliente.id)) {
        return invalido(res, 'email', 'Ese correo ya está en uso por otra cuenta', 409);
      }

      await req.db.query('UPDATE clientes SET email_pendiente = ? WHERE id = ? AND tenant_id = @tenant', [emailNuevo, req.cliente.id]);
      await enviarCodigoCambio(req.db, req.tallerSlug, req.cliente.id, emailNuevo, actual.nombre);
      // Al correo viejo le avisamos aunque el cambio no esté hecho: si le robaron la
      // sesión, ese aviso es la única forma de que el dueño se entere a tiempo.
      await enviarAvisoCambioCorreo(actual.email, actual.nombre, emailNuevo, await marcaDelTaller(req.db, req.tallerSlug));
    }

    // Recién acá se tocan los demás datos: si el cambio de correo se rechazó por
    // contraseña incorrecta, no queremos haber guardado el nombre a medias.
    await req.db.query(
      'UPDATE clientes SET nombre = ?, apellido = ?, telefono = ? WHERE id = ? AND tenant_id = @tenant',
      [nombre.trim(), apellido.trim(), (telefono || '').trim() || null, req.cliente.id]
    );

    const [[c]] = await req.db.query(
      'SELECT id, nombre, apellido, email, email_pendiente, telefono, cedula FROM clientes WHERE id = ? AND tenant_id = @tenant',
      [req.cliente.id]
    );
    res.json({
      data: c,
      cambio_correo_pendiente: cambiaCorreo,
      message: cambiaCorreo
        ? `Te enviamos un código a ${emailNuevo}. Hasta que lo confirmes sigues entrando con tu correo actual.`
        : 'Perfil actualizado',
    });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/portal/perfil/email/confirmar — aplica el cambio de correo pendiente.
router.post('/perfil/email/confirmar', async (req, res) => {
  try {
    const { codigo } = req.body;
    if (!codigo) return invalido(res, 'codigo', 'Falta el código');

    const [[c]] = await req.db.query(
      'SELECT nombre, email, email_pendiente FROM clientes WHERE tenant_id = @tenant AND id = ? AND activo = 1', [req.cliente.id]
    );
    if (!c || !c.email_pendiente) return res.status(400).json({ error: 'No hay ningún cambio de correo pendiente' });

    const limite = consumir(`cambio-correo-verificar:${req.cliente.id}`, { porMinuto: 5, porHora: 20 });
    if (!limite.ok) {
      return res.status(429).json({ error: `Demasiados intentos. Espera ${limite.retryAfter}s e intenta de nuevo.` });
    }

    const ERR_CODIGO = 'Código inválido o expirado';
    const [[reg]] = await req.db.query(
      `SELECT id, code_hash, attempts FROM email_verify_codes
       WHERE tenant_id = @tenant AND cliente_id = ? AND proposito = 'cambio' AND used = 0 AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [req.cliente.id]
    );
    if (!reg || reg.attempts >= 5) return invalido(res, 'codigo', ERR_CODIGO);

    if (!(await bcrypt.compare(String(codigo).trim(), reg.code_hash))) {
      await req.db.query('UPDATE email_verify_codes SET attempts = attempts + 1 WHERE tenant_id = @tenant AND id = ?', [reg.id]);
      return invalido(res, 'codigo', ERR_CODIGO);
    }

    // Se vuelve a comprobar acá: entre el pedido y la confirmación alguien más pudo
    // haberse quedado con ese correo.
    if (await correoOcupado(req.db, c.email_pendiente, req.cliente.id)) {
      await req.db.query('UPDATE clientes SET email_pendiente = NULL WHERE tenant_id = @tenant AND id = ?', [req.cliente.id]);
      return invalido(res, 'email', 'Ese correo ya está en uso por otra cuenta', 409);
    }

    await req.db.query('UPDATE email_verify_codes SET used = 1 WHERE id = ? AND tenant_id = @tenant', [reg.id]);
    await req.db.query(
      'UPDATE clientes SET email = email_pendiente, email_verificado = 1, email_pendiente = NULL WHERE id = ? AND tenant_id = @tenant',
      [req.cliente.id]
    );

    const [[actualizado]] = await req.db.query(
      'SELECT id, nombre, apellido, email, email_pendiente, telefono, cedula FROM clientes WHERE id = ? AND tenant_id = @tenant',
      [req.cliente.id]
    );
    res.json({ data: actualizado, message: 'Listo, ese ya es tu correo. Usalo la próxima vez que entres.' });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/portal/perfil/email/reenviar — otro código a la dirección pendiente.
router.post('/perfil/email/reenviar', async (req, res) => {
  try {
    const [[c]] = await req.db.query(
      'SELECT nombre, email_pendiente FROM clientes WHERE tenant_id = @tenant AND id = ? AND activo = 1', [req.cliente.id]
    );
    if (!c || !c.email_pendiente) return res.status(400).json({ error: 'No hay ningún cambio de correo pendiente' });

    const limite = consumir(`cambio-correo:${req.cliente.id}`, { porMinuto: 2, porHora: 10 });
    if (!limite.ok) {
      return res.status(429).json({ error: `Espera ${limite.retryAfter}s antes de pedir otro código.` });
    }

    await enviarCodigoCambio(req.db, req.tallerSlug, req.cliente.id, c.email_pendiente, c.nombre);
    res.json({ message: `Te enviamos otro código a ${c.email_pendiente}.` });
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /api/portal/perfil/email — descarta el cambio pendiente (se equivocó al escribir,
// o el dueño real recibió el aviso y quiere frenarlo).
router.delete('/perfil/email', async (req, res) => {
  try {
    await req.db.query("UPDATE email_verify_codes SET used = 1 WHERE tenant_id = @tenant AND cliente_id = ? AND proposito = 'cambio' AND used = 0", [req.cliente.id]);
    await req.db.query('UPDATE clientes SET email_pendiente = NULL WHERE id = ? AND tenant_id = @tenant', [req.cliente.id]);
    res.json({ message: 'Cambio de correo cancelado' });
  } catch (err) {
    fail(res, err);
  }
});

// PUT /api/portal/perfil/notificaciones — preferencias de notificación del cliente.
router.put('/perfil/notificaciones', async (req, res) => {
  try {
    const avances = req.body.notif_avances ? 1 : 0;
    const recordatorios = req.body.notif_recordatorios ? 1 : 0;
    await req.db.query(
      'UPDATE clientes SET notif_avances = ?, notif_recordatorios = ? WHERE id = ? AND tenant_id = @tenant',
      [avances, recordatorios, req.cliente.id]
    );
    res.json({ data: { notif_avances: avances, notif_recordatorios: recordatorios }, message: 'Preferencias actualizadas' });
  } catch (err) {
    fail(res, err);
  }
});

// PUT /api/portal/perfil/password — cambia la contraseña verificando la actual
router.put('/perfil/password', async (req, res) => {
  try {
    const { actual, nueva } = req.body;
    if (faltante(res, req.body, [['actual', 'la contraseña actual'], ['nueva', 'la nueva contraseña']])) return;
    const malaClave = problemaDeContrasena(nueva, PISO);
    if (malaClave) return invalido(res, 'nueva', malaClave);
    const [[c]] = await req.db.query('SELECT password_hash FROM clientes WHERE tenant_id = @tenant AND id = ? AND activo = 1', [req.cliente.id]);
    if (!c || !c.password_hash) return res.status(404).json({ error: 'Cuenta no encontrada' });
    const ok = await bcrypt.compare(String(actual), c.password_hash);
    if (!ok) return invalido(res, 'actual', 'La contraseña actual no es correcta');
    const hash = await bcrypt.hash(String(nueva), 10);
    await req.db.query('UPDATE clientes SET password_hash = ? WHERE id = ? AND tenant_id = @tenant', [hash, req.cliente.id]);
    // Las otras sesiones salen; esta, donde se hizo el cambio, sigue.
    await cerrarSesionesDeCliente(req.cliente.id, req.cliente.iat);
    res.json({ message: 'Contraseña actualizada' });
  } catch (err) {
    fail(res, err);
  }
});

// PUT /api/portal/perfil/foto — el cliente sube/cambia/quita su foto de perfil.
// Se envía aparte de los datos de contacto para no reenviar la imagen en cada
// edición de nombre/teléfono. `foto` = data URL base64 (o null/'' para quitarla).
router.put('/perfil/foto', async (req, res) => {
  try {
    const { foto } = req.body;
    if (!fotoValida(foto)) {
      return res.status(400).json({ error: 'La imagen no es válida o es demasiado grande.' });
    }
    const val = fotoParaGuardar(foto);
    await req.db.query('UPDATE clientes SET foto = ? WHERE id = ? AND tenant_id = @tenant', [val, req.cliente.id]);
    res.json({ data: { foto: val }, message: val ? 'Foto actualizada' : 'Foto eliminada' });
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /api/portal/perfil — el cliente da de baja su propia cuenta.
// Soft-delete: NO se borran sus datos históricos (órdenes/citas) por integridad
// del taller; se desactiva el acceso al portal (activo=0 + sin contraseña).
router.delete('/perfil', async (req, res) => {
  try {
    await req.db.query('UPDATE clientes SET activo = 0, password_hash = NULL WHERE id = ? AND tenant_id = @tenant', [req.cliente.id]);
    olvidarCliente(req.cliente.id);
    res.json({ message: 'Cuenta eliminada' });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/portal/sucursales — locales activos para el selector del formulario de citas.
router.get('/sucursales', async (req, res) => {
  try {
    const activas = await getSucursales(req.db, { soloActivas: true });
    res.json({ data: activas.map((s) => ({ id: s.id, nombre: s.nombre, direccion: s.direccion })) });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/portal/servicios — lo que el cliente puede elegir al agendar. Se sirve desde
// la base para que coincida siempre con lo que valida POST /citas: antes el catálogo
// estaba copiado en el frontend y podía quedar desfasado del que exige el servidor.
router.get('/servicios', async (req, res) => {
  try {
    res.json({ data: await getServicios(req.db) });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/portal/disponibilidad?fecha=&sucursal_id= — conteo de citas por hora ese día
// y sucursal. El horario es compartido (config), pero el cupo se cuenta POR sucursal:
// una cita en un local no ocupa el cupo del otro.
router.get('/disponibilidad', async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha) return res.status(400).json({ error: 'Fecha requerida' });
    // Sucursal: la pedida (si es válida) o la primera activa por compatibilidad.
    let sucursalId = Number(req.query.sucursal_id);
    if (!(await sucursalValida(req.db, sucursalId))) sucursalId = await sucursalPorDefecto(req.db);
    const config = await getConfig(req.db);
    // Cada cita cuenta en todas las horas que dura (ver utils/agenda.js).
    const dia = await agendaDia(fecha, sucursalId, config, { db: req.db });
    // Las horas que bloqueó administración no se ofrecen: van fuera de `horas` y
    // como llenas en `ocupacion` (la pantalla del portal las tacha). El cliente no
    // necesita saber por qué no hay lugar.
    // Tampoco las que ya empezaron: no se confía en el reloj del celular del cliente.
    const pasadas = horasPasadas(String(fecha).slice(0, 10), dia.horas, config.zona_horaria_offset);
    const horas = dia.horas.filter((h) => dia.bloqueadas[h] === undefined && !pasadas.includes(h));
    const ocupacion = { ...dia.ocupacion };
    for (const h of Object.keys(dia.bloqueadas)) ocupacion[h] = Number(config.max_citas_hora) || 1;
    // `todas`: las del horario de ese día (para dibujar la grilla, con las no disponibles
    // tachadas); `horas`: las que se pueden elegir. Día cerrado = las dos vacías.
    res.json({ data: { horas, todas: dia.horas, max: config.max_citas_hora, ocupacion, sucursal_id: sucursalId } });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/portal/proximo-libre — primer horario con cupo (para "sugerir próximo horario").
// Recorre día por día desde hoy hasta dias_anticipacion, según horarios y cupo configurados.
router.get('/proximo-libre', async (req, res) => {
  try {
    // El cupo es por sucursal: la sugerencia se calcula para la sucursal pedida.
    let sucursalId = Number(req.query.sucursal_id);
    if (!(await sucursalValida(req.db, sucursalId))) sucursalId = await sucursalPorDefecto(req.db);
    const config = await getConfig(req.db);
    const max = Number(config.max_citas_hora) || 1;
    const dias = Number(config.dias_anticipacion) || 30;
    const hoy = await hoyCR(req.db);
    const fin = new Date(`${hoy}T00:00:00Z`);
    fin.setUTCDate(fin.getUTCDate() + dias);
    const finStr = fin.toISOString().slice(0, 10);

    // Ocupación (con la duración de cada cita) y bloqueos de todo el rango, por sucursal.
    const agenda = await agendaRango(hoy, finStr, sucursalId, config, { db: req.db });

    // Primer slot con cupo, sin bloquear y que aún no haya pasado.
    const cursor = new Date(`${hoy}T00:00:00Z`);
    for (let i = 0; i <= dias; i++) {
      const fecha = cursor.toISOString().slice(0, 10);
      const dia = agenda[fecha] || { horas: horasDisponibles(fecha, config), ocupacion: {}, bloqueadas: {} };
      for (const hora of dia.horas) {
        const usados = dia.ocupacion[hora] || 0;
        if (dia.bloqueadas[hora] === undefined && usados < max && horasHastaCita(fecha, hora) > 0) {
          return res.json({ data: { fecha, hora, sucursal_id: sucursalId } });
        }
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    res.json({ data: null }); // no hay horarios libres en la ventana
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/portal/ordenes — órdenes del cliente autenticado
router.get('/ordenes', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT o.id, o.numero_orden, o.estado, o.problema_reportado, o.aprobacion_cliente,
              o.total_aprobado, o.fecha_ingreso, o.fecha_estimada_entrega,
              m.marca, m.modelo, m.placa
       FROM ordenes_trabajo o
       JOIN vehiculos m ON m.id = o.vehiculo_id AND m.tenant_id = @tenant
       WHERE o.tenant_id = @tenant AND o.cliente_id = ?
       ORDER BY o.fecha_ingreso DESC`,
      [req.cliente.id]
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/portal/ordenes/:id — detalle de una orden propia
router.get('/ordenes/:id', async (req, res) => {
  try {
    const [[orden]] = await req.db.query(
      `SELECT o.id, o.numero_orden, o.estado, o.problema_reportado, o.diagnostico,
              o.costo_mano_obra, o.costo_repuestos, o.descuento,
              (o.costo_mano_obra + o.costo_repuestos - o.descuento) AS total,
              o.aprobacion_cliente, o.motivo_rechazo, o.tiempo_estimado_horas, o.total_aprobado,
              o.fecha_ingreso, o.fecha_estimada_entrega, o.fecha_entrega_real,
              o.metodo_pago, o.garantia_dias, o.calificacion, o.comentario_satisfaccion,
              m.marca, m.modelo, m.placa, m.anio,
              u.nombre AS tecnico_nombre
       FROM ordenes_trabajo o
       JOIN vehiculos m ON m.id = o.vehiculo_id AND m.tenant_id = @tenant
       LEFT JOIN usuarios u ON u.id = o.tecnico_id AND u.tenant_id = @tenant
       WHERE o.tenant_id = @tenant AND o.id = ? AND o.cliente_id = ?`,
      [req.params.id, req.cliente.id]
    );
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

    const [avances] = await req.db.query(
      `SELECT a.descripcion, a.created_at, u.nombre AS usuario_nombre
       FROM orden_avances a LEFT JOIN usuarios u ON u.id = a.usuario_id AND u.tenant_id = @tenant
       WHERE a.tenant_id = @tenant AND a.orden_id = ? ORDER BY a.created_at ASC`,
      [req.params.id]
    );
    const [repuestos] = await req.db.query(
      // Lo que el cliente rechazó no se le cobra: no figura en su detalle ni en el comprobante.
      'SELECT nombre, cantidad, costo_unitario, estado, adicional FROM orden_repuestos WHERE tenant_id = @tenant AND orden_id = ? AND rechazado = 0 ORDER BY created_at ASC',
      [req.params.id]
    );
    const [fotos] = await req.db.query(
      'SELECT url, tipo, descripcion FROM orden_fotos WHERE tenant_id = @tenant AND orden_id = ? ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json({ data: { ...orden, avances, repuestos, fotos } });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/portal/ordenes/:id/aprobar — el cliente aprueba el presupuesto
router.post('/ordenes/:id/aprobar', async (req, res) => {
  try {
    const ok = await actualizarAprobacion(req.db, req.params.id, req.cliente.id, 'aprobado', null);
    if (!ok) return res.status(400).json({ error: 'La orden no está esperando aprobación' });
    res.json({ message: 'Presupuesto aprobado' });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/portal/ordenes/:id/rechazar — el cliente rechaza el presupuesto
router.post('/ordenes/:id/rechazar', async (req, res) => {
  try {
    const motivoRechazo = String(req.body.motivo || '').trim() || null;
    if (!textoDentroDeLimite(motivoRechazo, MAX_MOTIVO_RECHAZO)) {
      return res.status(400).json({ error: `motivo no puede exceder ${MAX_MOTIVO_RECHAZO} caracteres` });
    }
    const ok = await actualizarAprobacion(req.db, req.params.id, req.cliente.id, 'rechazado', motivoRechazo);
    if (!ok) return res.status(400).json({ error: 'La orden no está esperando aprobación' });
    res.json({ message: 'Presupuesto rechazado' });
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/portal/ordenes/:id/encuesta — calificación de satisfacción (1-5)
router.post('/ordenes/:id/encuesta', async (req, res) => {
  try {
    const calificacion = Number(req.body.calificacion);
    if (!(calificacion >= 1 && calificacion <= 5)) {
      return res.status(400).json({ error: 'La calificación debe ser de 1 a 5' });
    }
    const [[orden]] = await req.db.query(
      "SELECT id, calificacion FROM ordenes_trabajo WHERE tenant_id = @tenant AND id = ? AND cliente_id = ? AND estado = 'entregada'",
      [req.params.id, req.cliente.id]
    );
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada o no entregada' });
    if (orden.calificacion) return res.status(400).json({ error: 'Ya calificaste esta orden' });

    await req.db.query(
      'UPDATE ordenes_trabajo SET calificacion = ?, comentario_satisfaccion = ? WHERE id = ? AND tenant_id = @tenant',
      [calificacion, req.body.comentario || null, req.params.id]
    );
    res.json({ message: '¡Gracias por tu opinión!' });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/portal/fidelidad — estado de fidelización del cliente.
// Misma fuente de verdad que /resumen: citas entregadas (no el viejo contador
// por órdenes), para que ambas pantallas siempre coincidan.
router.get('/fidelidad', async (req, res) => {
  try {
    const [[{ completadas }]] = await req.db.query(
      `SELECT
         (SELECT COUNT(*) FROM citas WHERE tenant_id = @tenant AND cliente_id = ? AND estado = 'entregado')
       + (SELECT COUNT(*) FROM ordenes_trabajo
            WHERE tenant_id = @tenant AND cliente_id = ? AND estado = 'entregada'
              AND id NOT IN (SELECT orden_id FROM citas WHERE tenant_id = @tenant AND orden_id IS NOT NULL)) AS completadas`,
      [req.cliente.id, req.cliente.id]
    );
    const r = recompensas(completadas);
    res.json({
      data: { visitas: r.completadas, cortesia_disponible: r.cortesia_disponible, meta: r.meta, faltan: r.faltan },
    });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/portal/recompensas — historial de cortesías canjeadas del cliente.
router.get('/recompensas', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT rc.id, to_char(rc.created_at, 'YYYY-MM-DD') AS fecha, rc.descripcion, o.numero_orden,
              to_char(rc.devuelta_en, 'YYYY-MM-DD') AS devuelta
       FROM recompensas_canjeadas rc
       LEFT JOIN ordenes_trabajo o ON o.id = rc.orden_id AND o.tenant_id = @tenant
       WHERE rc.tenant_id = @tenant AND rc.cliente_id = ?
       ORDER BY rc.created_at DESC`,
      [req.cliente.id]
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/portal/promos — promociones activas (sin imagen pesada para carga rápida)
router.get('/promos', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT id, titulo, descripcion, descuento, precio_final,
              CASE WHEN imagen IS NOT NULL THEN 1 ELSE 0 END AS tiene_imagen
       FROM promos WHERE tenant_id = @tenant AND activa = 1 ORDER BY created_at DESC`
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/portal/promos/:id/imagen — imagen individual (lazy load)
router.get('/promos/:id/imagen', async (req, res) => {
  try {
    const [[row]] = await req.db.query('SELECT imagen FROM promos WHERE tenant_id = @tenant AND id = ? AND activa = 1', [req.params.id]);
    if (!row || !row.imagen) return res.status(404).json({ error: 'Sin imagen' });
    res.json({ data: row.imagen });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/portal/motos — motos del cliente (para asociar a una cita)
router.get('/vehiculos', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT m.id, m.tipo, m.atributos, m.marca, m.modelo, m.placa, m.anio, m.color, m.kilometraje_actual, m.foto,
              (SELECT to_char(MAX(COALESCE(c.fecha_fin, c.fecha)), 'YYYY-MM-DD')
               FROM citas c WHERE c.tenant_id = @tenant AND c.vehiculo_id = m.id AND c.estado = 'entregado') AS ultimo_servicio
       FROM vehiculos m WHERE m.tenant_id = @tenant AND m.cliente_id = ? AND m.activa = 1 ORDER BY m.created_at DESC`,
      [req.cliente.id]
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/portal/vehiculos/tipos — los que atiende su taller, con sus campos.
router.get('/vehiculos/tipos', async (req, res) => {
  try {
    res.json(catalogoDelTaller((await getConfig(req.db)).tipos_vehiculo));
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/portal/motos — el cliente registra una moto propia
// Obligatorios: marca, modelo, placa. Evita placas duplicadas.
router.post('/vehiculos', async (req, res) => {
  try {
    const { marca, modelo, placa, anio, color, kilometraje_actual, foto } = req.body;
    if (faltante(res, req.body, [['marca', 'la marca'], ['modelo', 'el modelo'], ['placa', 'la placa']])) return;
    if (!placaValida(placa)) return invalido(res, 'placa', 'La placa no tiene un formato válido');
    if (!anioValido(anio)) return invalido(res, 'anio', 'El año no es válido');
    if (!fotoValida(foto)) return invalido(res, 'foto', 'La foto del vehículo no es válida o es demasiado grande.');
    // Bloquea placas ya registradas (normaliza espacios y guiones).
    const [[existe]] = await req.db.query(
      `SELECT id FROM vehiculos WHERE tenant_id = @tenant AND activa = 1
         AND UPPER(REPLACE(REPLACE(placa, ' ', ''), '-', '')) = UPPER(REPLACE(REPLACE(?, ' ', ''), '-', ''))`,
      [placa]
    );
    if (existe) return invalido(res, 'placa', 'Esa placa ya está registrada en el taller', 409);

    // El cliente elige entre los tipos que atiende SU taller. Si el taller atiende
    // uno solo (el caso común) no se le pregunta nada: se usa ese.
    const cfgTaller = await getConfig(req.db);
    const tiposDelTaller = normalizarTipos(cfgTaller.tipos_vehiculo);
    const tipoPedido = String(req.body.tipo || tiposDelTaller[0]).toLowerCase();
    if (!tiposDelTaller.includes(tipoPedido)) {
      return res.status(400).json({ error: 'El taller no atiende ese tipo de vehículo' });
    }
    const atributos = limpiarAtributos(tipoPedido, req.body.atributos);

    const [result] = await req.db.query(
      `INSERT INTO vehiculos (tenant_id, cliente_id, tipo, marca, modelo, placa, anio, color, kilometraje_actual, foto, atributos)
       VALUES (@tenant, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.cliente.id, tipoPedido, marca, modelo, placa, anio || null, color || null, kilometraje_actual || 0, fotoParaGuardar(foto), atributos ? JSON.stringify(atributos) : null]
    );
    const [[nueva]] = await req.db.query(
      'SELECT id, tipo, atributos, marca, modelo, placa, anio, color, kilometraje_actual, foto FROM vehiculos WHERE id = ? AND tenant_id = @tenant',
      [result.insertId]
    );
    res.status(201).json({ data: nueva, message: 'Vehículo registrado' });
  } catch (err) {
    fail(res, err);
  }
});

// PUT /api/portal/motos/:id — el cliente edita su propia moto
router.put('/vehiculos/:id', async (req, res) => {
  try {
    const { marca, modelo, placa, anio, color, kilometraje_actual, foto } = req.body;
    if (faltante(res, req.body, [['marca', 'la marca'], ['modelo', 'el modelo'], ['placa', 'la placa']])) return;
    if (!placaValida(placa)) return invalido(res, 'placa', 'La placa no tiene un formato válido');
    if (!anioValido(anio)) return invalido(res, 'anio', 'El año no es válido');
    if (!fotoValida(foto)) return invalido(res, 'foto', 'La foto del vehículo no es válida o es demasiado grande.');
    // La moto debe ser del cliente
    const [[moto]] = await req.db.query('SELECT id, tipo FROM vehiculos WHERE tenant_id = @tenant AND id = ? AND cliente_id = ? AND activa = 1', [req.params.id, req.cliente.id]);
    if (!moto) return res.status(404).json({ error: 'Vehículo no encontrado' });
    // El tipo solo si vino, y se revisa antes de guardar nada.
    const tipo = req.body.tipo === undefined ? undefined : String(req.body.tipo).toLowerCase();
    if (tipo !== undefined && !puedeUsarTipo(tipo, (await getConfig(req.db)).tipos_vehiculo, moto.tipo)) {
      return res.status(400).json({ error: 'El taller no atiende ese tipo de vehículo' });
    }
    // Placa duplicada (excluyendo la propia)
    const [[dup]] = await req.db.query(
      `SELECT id FROM vehiculos WHERE tenant_id = @tenant AND activa = 1 AND id <> ?
         AND UPPER(REPLACE(REPLACE(placa, ' ', ''), '-', '')) = UPPER(REPLACE(REPLACE(?, ' ', ''), '-', ''))`,
      [req.params.id, placa]
    );
    if (dup) return invalido(res, 'placa', 'Esa placa ya está registrada en el taller', 409);

    await req.db.query(
      'UPDATE vehiculos SET marca = ?, modelo = ?, placa = ?, anio = ?, color = ?, kilometraje_actual = ?, foto = ? WHERE id = ? AND tenant_id = @tenant',
      [marca, modelo, placa, anio || null, color || null, kilometraje_actual || 0, fotoParaGuardar(foto), req.params.id]
    );
    if (tipo !== undefined) {
      const propios = limpiarAtributos(tipo, req.body.atributos);
      await req.db.query(
        'UPDATE vehiculos SET tipo = ?, atributos = ? WHERE id = ? AND tenant_id = @tenant',
        [tipo, propios ? JSON.stringify(propios) : null, req.params.id]
      );
    }
    const [[actualizada]] = await req.db.query(
      'SELECT id, tipo, atributos, marca, modelo, placa, anio, color, kilometraje_actual, foto FROM vehiculos WHERE id = ? AND tenant_id = @tenant',
      [req.params.id]
    );
    res.json({ data: actualizada, message: 'Vehículo actualizado' });
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /api/portal/motos/:id — el cliente da de baja una moto propia (soft-delete).
// No se borra la fila (preserva el historial de citas/órdenes); deja de aparecer en su lista.
router.delete('/vehiculos/:id', async (req, res) => {
  try {
    const [[moto]] = await req.db.query('SELECT id FROM vehiculos WHERE tenant_id = @tenant AND id = ? AND cliente_id = ? AND activa = 1', [req.params.id, req.cliente.id]);
    if (!moto) return res.status(404).json({ error: 'Vehículo no encontrado' });
    await req.db.query('UPDATE vehiculos SET activa = 0 WHERE id = ? AND tenant_id = @tenant', [req.params.id]);
    res.json({ message: 'Vehículo eliminado' });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/portal/motos/:id/historial — línea de tiempo de servicios de una moto.
// Devuelve la moto + sus citas entregadas (qué se le hizo y cuándo). No filtra por
// activa=1: el historial sobrevive aunque el cliente haya eliminado la moto de su lista.
router.get('/vehiculos/:id/historial', async (req, res) => {
  try {
    const [[moto]] = await req.db.query(
      'SELECT id, tipo, atributos, marca, modelo, placa, anio, color, kilometraje_actual, foto FROM vehiculos WHERE tenant_id = @tenant AND id = ? AND cliente_id = ?',
      [req.params.id, req.cliente.id]
    );
    if (!moto) return res.status(404).json({ error: 'Vehículo no encontrado' });

    const [servicios] = await req.db.query(
      `SELECT ci.id, to_char(COALESCE(ci.fecha_fin, ci.fecha), 'YYYY-MM-DD') AS fecha,
              ci.tipo_servicio, ci.servicios, ci.motivo, ci.monto, ci.calificacion,
              ci.orden_id, o.numero_orden, o.diagnostico,
              t.nombre AS tecnico_nombre
       FROM citas ci
       LEFT JOIN ordenes_trabajo o ON o.id = ci.orden_id AND o.tenant_id = @tenant
       LEFT JOIN usuarios t ON t.id = ci.tecnico_id AND t.tenant_id = @tenant
       WHERE ci.tenant_id = @tenant AND ci.vehiculo_id = ? AND ci.cliente_id = ? AND ci.estado = 'entregado'
       ORDER BY COALESCE(ci.fecha_fin, ci.fecha) DESC, ci.hora DESC`,
      [req.params.id, req.cliente.id]
    );
    res.json({ data: { moto, servicios } });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/portal/citas — citas del cliente
router.get('/citas', async (req, res) => {
  try {
    const [rows] = await req.db.query(
      `SELECT ci.id, to_char(ci.fecha, 'YYYY-MM-DD') AS fecha, to_char(ci.hora, 'HH24:MI') AS hora,
              ci.motivo, ci.tipo_servicio, ci.servicios, ci.estado,
              ci.monto, ci.calificacion, ci.confirmada_cliente,
              ci.orden_id, o.numero_orden, o.estado AS orden_estado, o.aprobacion_cliente,
              m.marca, m.modelo, m.placa,
              t.nombre AS tecnico_nombre,
              ci.sucursal_id, s.nombre AS sucursal_nombre
       FROM citas ci
       LEFT JOIN vehiculos m ON m.id = ci.vehiculo_id AND m.tenant_id = @tenant
       LEFT JOIN usuarios t ON t.id = ci.tecnico_id AND t.tenant_id = @tenant
       LEFT JOIN ordenes_trabajo o ON o.id = ci.orden_id AND o.tenant_id = @tenant
       LEFT JOIN sucursales s ON s.id = ci.sucursal_id AND s.tenant_id = @tenant
       WHERE ci.tenant_id = @tenant AND ci.cliente_id = ? AND ci.estado <> 'cancelado'
       ORDER BY ci.fecha DESC, ci.hora DESC`,
      [req.cliente.id]
    );
    res.json({ data: rows });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/portal/citas/:id — detalle de una cita propia (para la pantalla de detalle)
router.get('/citas/:id', async (req, res) => {
  try {
    const [[cita]] = await req.db.query(
      `SELECT ci.id, to_char(ci.fecha, 'YYYY-MM-DD') AS fecha, to_char(ci.hora, 'HH24:MI') AS hora,
              ci.motivo, ci.tipo_servicio, ci.servicios, ci.estado, ci.vehiculo_id,
              ci.monto, ci.calificacion, ci.comentario_satisfaccion, ci.fecha_inicio, ci.fecha_fin,
              ci.confirmada_cliente,
              ci.orden_id, o.numero_orden, o.estado AS orden_estado, o.aprobacion_cliente,
              m.marca, m.modelo, m.placa, m.foto AS moto_foto,
              t.nombre AS tecnico_nombre,
              ci.sucursal_id, s.nombre AS sucursal_nombre, s.direccion AS sucursal_direccion
       FROM citas ci
       LEFT JOIN vehiculos m ON m.id = ci.vehiculo_id AND m.tenant_id = @tenant
       LEFT JOIN usuarios t ON t.id = ci.tecnico_id AND t.tenant_id = @tenant
       LEFT JOIN ordenes_trabajo o ON o.id = ci.orden_id AND o.tenant_id = @tenant
       LEFT JOIN sucursales s ON s.id = ci.sucursal_id AND s.tenant_id = @tenant
       WHERE ci.tenant_id = @tenant AND ci.id = ? AND ci.cliente_id = ?`,
      [req.params.id, req.cliente.id]
    );
    if (!cita) return res.status(404).json({ error: 'Cita no encontrada' });
    res.json({ data: cita });
  } catch (err) {
    fail(res, err);
  }
});

// PUT /api/portal/citas/:id — el cliente reprograma/edita su cita.
// Solo mientras está 'agendado', sin orden iniciada y respetando la ventana mínima.
// Revalida la NUEVA fecha/hora con las mismas reglas que agendar (cupo atómico).
router.put('/citas/:id', async (req, res) => {
  try {
    const { vehiculo_id, fecha, hora, descripcion } = req.body;
    // Uno o varios servicios del catálogo (`tipo_servicio` suelto: la app sin actualizar).
    const servicios = serviciosDelPedido(req.body);
    if (!vehiculo_id || !fecha || !hora || !servicios.length) {
      return res.status(400).json({ error: 'Vehículo, servicio, fecha y hora son requeridos' });
    }
    const problemaServicios = await problemaConServicios(req.db, servicios, { obligatorio: true, delCatalogo: true });
    if (problemaServicios) return invalido(res, 'servicios', problemaServicios);
    // Sucursal: la pedida (si es válida) o se conserva la actual de la cita más abajo.
    const sucursalPedida = (await sucursalValida(req.db, req.body.sucursal_id)) ? Number(req.body.sucursal_id) : null;

    const [[cita]] = await req.db.query(
      "SELECT id, estado, orden_id, sucursal_id, duracion_horas, to_char(fecha, 'YYYY-MM-DD') AS fecha, to_char(hora, 'HH24:MI') AS hora FROM citas WHERE tenant_id = @tenant AND id = ? AND cliente_id = ?",
      [req.params.id, req.cliente.id]
    );
    if (!cita) return res.status(404).json({ error: 'Cita no encontrada' });
    if (cita.estado !== 'agendado' || cita.orden_id) {
      return res.status(400).json({ error: 'Esta cita ya no se puede modificar. Comunícate con el taller.' });
    }

    const config = await getConfig(req.db);
    const minH = Number(config.cancelacion_horas_min || 0);
    // Ventana mínima sobre la cita ACTUAL (no reprogramar a último momento).
    if (minH > 0 && horasHastaCita(cita.fecha, cita.hora) < minH) {
      return res.status(400).json({ error: `No se puede modificar con menos de ${minH} h de anticipación. Comunícate con el taller.` });
    }

    // Validaciones de la NUEVA fecha/hora (mismas reglas que agendar).
    const horas = horasDisponibles(fecha, config);
    if (!horas.includes(hora)) {
      return invalido(res, 'hora', 'Ese día/hora no está disponible para agendar');
    }
    const hoy = await hoyCR(req.db);
    if (fecha < hoy) return invalido(res, 'fecha', 'La fecha no puede ser en el pasado');
    if (fecha === hoy && horasHastaCita(fecha, hora) <= 0) {
      return invalido(res, 'hora', 'Esa hora ya pasó. Elige un horario más tarde.');
    }
    const limiteFecha = new Date(`${hoy}T12:00:00Z`);
    limiteFecha.setUTCDate(limiteFecha.getUTCDate() + Number(config.dias_anticipacion || 30));
    if (fecha > limiteFecha.toISOString().slice(0, 10)) {
      return invalido(res, 'fecha', `Solo se puede agendar hasta ${config.dias_anticipacion} días por adelantado`);
    }

    const [[moto]] = await req.db.query('SELECT id FROM vehiculos WHERE tenant_id = @tenant AND id = ? AND cliente_id = ?', [vehiculo_id, req.cliente.id]);
    if (!moto) return invalido(res, 'vehiculo_id', 'Vehículo no válido');

    const motivo = (descripcion || '').trim() || textoServicios(servicios).slice(0, MAX_MOTIVO);
    if (!textoDentroDeLimite(motivo, MAX_MOTIVO)) {
      return invalido(res, 'descripcion', `La descripción no puede pasar de ${MAX_MOTIVO} caracteres`);
    }
    // Sucursal efectiva: la nueva pedida, o la que ya tenía la cita (fallback al default).
    const sucursalId = sucursalPedida || cita.sucursal_id || (await sucursalPorDefecto(req.db));

    // Cupo atómico de la NUEVA franja (por sucursal), excluyendo esta misma cita: en
    // todas las horas que dura (si administración la alargó) y sin horas bloqueadas.
    const conn = await req.db.conexion();
    try {
      await conn.beginTransaction();
      const dia = await agendaDia(fecha, sucursalId, config, { db: conn, bloquear: true, excluirId: req.params.id });
      if (conflictosDeCita(dia, hora, cita.duracion_horas, Number(config.max_citas_hora) || 1).length) {
        await conn.rollback();
        return invalido(res, 'hora', 'Esa hora ya no está disponible, elige otra.');
      }
      await conn.query(
        'UPDATE citas SET vehiculo_id = ?, fecha = ?, hora = ?, motivo = ?, sucursal_id = ? WHERE tenant_id = @tenant AND id = ?',
        [vehiculo_id, fecha, hora, motivo, sucursalId, req.params.id]
      );
      await guardarServiciosCita(req.params.id, servicios, conn);
      const [[actualizada]] = await conn.query(
        `SELECT ci.id, ci.fecha, ci.hora, ci.motivo, ci.tipo_servicio, ci.servicios, ci.estado, m.marca, m.modelo, m.placa
         FROM citas ci LEFT JOIN vehiculos m ON m.id = ci.vehiculo_id AND m.tenant_id = @tenant WHERE ci.tenant_id = @tenant AND ci.id = ?`,
        [req.params.id]
      );
      await conn.commit();
      res.json({ data: actualizada, message: 'Cita actualizada' });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/portal/citas — el cliente solicita una cita (queda pendiente de confirmar)
router.post('/citas', async (req, res) => {
  try {
    const { vehiculo_id, fecha, hora, descripcion } = req.body;
    // Uno o varios servicios del catálogo (`tipo_servicio` suelto: la app sin actualizar).
    const servicios = serviciosDelPedido(req.body);
    if (!vehiculo_id || !fecha || !hora || !servicios.length) {
      return res.status(400).json({ error: 'Vehículo, servicio, fecha y hora son requeridos' });
    }
    const problemaServicios = await problemaConServicios(req.db, servicios, { obligatorio: true, delCatalogo: true });
    if (problemaServicios) return invalido(res, 'servicios', problemaServicios);
    // Sucursal obligatoria y válida (activa). El cupo se controla por sucursal.
    const sucursalId = (await sucursalValida(req.db, req.body.sucursal_id)) ? Number(req.body.sucursal_id) : null;
    if (!sucursalId) return invalido(res, 'sucursal_id', 'Elige una sucursal válida');
    const config = await getConfig(req.db);
    const horas = horasDisponibles(fecha, config);
    if (!horas.includes(hora)) {
      return invalido(res, 'hora', 'Ese día/hora no está disponible para agendar');
    }
    const hoy = await hoyCR(req.db);
    if (fecha < hoy) {
      return invalido(res, 'fecha', 'La fecha no puede ser en el pasado');
    }
    // Si es hoy, no permitir horas que ya pasaron (el slot debe iniciar en el futuro).
    if (fecha === hoy && horasHastaCita(fecha, hora) <= 0) {
      return invalido(res, 'hora', 'Esa hora ya pasó. Elige un horario más tarde.');
    }
    // Tope de anticipación configurable: no se agenda más allá de N días.
    const limiteFecha = new Date(`${hoy}T12:00:00Z`);
    limiteFecha.setUTCDate(limiteFecha.getUTCDate() + Number(config.dias_anticipacion || 30));
    if (fecha > limiteFecha.toISOString().slice(0, 10)) {
      return invalido(res, 'fecha', `Solo se puede agendar hasta ${config.dias_anticipacion} días por adelantado`);
    }

    // Anti-spam: limita cuántas citas pide un mismo cliente.
    const limite = consumir(`cita:${req.cliente.id}`, { porMinuto: 3, porHora: 15 });
    if (!limite.ok) {
      return res.status(429).json({ error: `Estás agendando muy seguido. Espera ${limite.retryAfter}s.` });
    }

    // La moto debe ser del cliente
    const [[moto]] = await req.db.query('SELECT id FROM vehiculos WHERE tenant_id = @tenant AND id = ? AND cliente_id = ?', [vehiculo_id, req.cliente.id]);
    if (!moto) return invalido(res, 'vehiculo_id', 'Vehículo no válido');

    const motivo = (descripcion || '').trim() || textoServicios(servicios).slice(0, MAX_MOTIVO);
    if (!textoDentroDeLimite(motivo, MAX_MOTIVO)) {
      return invalido(res, 'descripcion', `La descripción no puede pasar de ${MAX_MOTIVO} caracteres`);
    }

    // Cupo atómico: una transacción bloquea las citas del día (FOR UPDATE), cuenta y
    // recién ahí inserta. Dos solicitudes simultáneas se serializan, así nunca se
    // superan las citas por hora (evita la carrera del COUNT+INSERT). Cuenta también
    // las citas largas que pasan por esa hora, y no deja agendar en horas bloqueadas.
    const conn = await req.db.conexion();
    try {
      await conn.beginTransaction();
      const dia = await agendaDia(fecha, sucursalId, config, { db: conn, bloquear: true });
      if (conflictosDeCita(dia, hora, 1, Number(config.max_citas_hora) || 1).length) {
        await conn.rollback();
        return invalido(res, 'hora', 'Esa hora ya no está disponible, elige otra.');
      }
      const [result] = await conn.query(
        "INSERT INTO citas (tenant_id, cliente_id, vehiculo_id, sucursal_id, fecha, hora, motivo, tipo_servicio, estado) VALUES (@tenant, ?, ?, ?, ?, ?, ?, ?, 'agendado')",
        [req.cliente.id, vehiculo_id, sucursalId, fecha, hora, motivo, servicios[0]]
      );
      await guardarServiciosCita(result.insertId, servicios, conn);
      const [[nueva]] = await conn.query(
        `SELECT ci.id, ci.fecha, ci.hora, ci.motivo, ci.tipo_servicio, ci.servicios, ci.estado, m.marca, m.modelo, m.placa
         FROM citas ci LEFT JOIN vehiculos m ON m.id = ci.vehiculo_id AND m.tenant_id = @tenant WHERE ci.tenant_id = @tenant AND ci.id = ?`,
        [result.insertId]
      );
      await conn.commit();
      res.status(201).json({ data: nueva, message: 'Solicitud de cita enviada' });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/portal/citas/:id/calificar — el cliente puntúa su cita ya entregada (1-5)
router.post('/citas/:id/calificar', async (req, res) => {
  try {
    const calificacion = Number(req.body.calificacion);
    if (!(calificacion >= 1 && calificacion <= 5)) {
      return res.status(400).json({ error: 'La calificación debe ser de 1 a 5' });
    }
    const [[cita]] = await req.db.query(
      "SELECT id, calificacion FROM citas WHERE tenant_id = @tenant AND id = ? AND cliente_id = ? AND estado = 'entregado'",
      [req.params.id, req.cliente.id]
    );
    if (!cita) return res.status(404).json({ error: 'Cita no encontrada o no entregada' });
    if (cita.calificacion) return res.status(400).json({ error: 'Ya calificaste esta cita' });

    await req.db.query(
      'UPDATE citas SET calificacion = ?, comentario_satisfaccion = ? WHERE id = ? AND tenant_id = @tenant',
      [calificacion, req.body.comentario || null, req.params.id]
    );
    res.json({ message: '¡Gracias por tu opinión!' });
  } catch (err) {
    fail(res, err);
  }
});

// PATCH /api/portal/citas/:id/cancelar — el cliente cancela su propia cita.
// Solo se permite mientras está 'agendado' y sin orden de trabajo iniciada
// (después la gestiona el taller). Libera el cupo de la franja.
router.patch('/citas/:id/cancelar', async (req, res) => {
  try {
    const [[cita]] = await req.db.query(
      "SELECT id, estado, orden_id, to_char(fecha, 'YYYY-MM-DD') AS fecha, to_char(hora, 'HH24:MI') AS hora FROM citas WHERE tenant_id = @tenant AND id = ? AND cliente_id = ?",
      [req.params.id, req.cliente.id]
    );
    if (!cita) return res.status(404).json({ error: 'Cita no encontrada' });
    if (cita.estado !== 'agendado' || cita.orden_id) {
      return res.status(400).json({ error: 'Esta cita ya no se puede cancelar. Comunícate con el taller.' });
    }
    const config = await getConfig(req.db);
    const minH = Number(config.cancelacion_horas_min || 0);
    if (minH > 0 && horasHastaCita(cita.fecha, cita.hora) < minH) {
      return res.status(400).json({ error: `No se puede cancelar con menos de ${minH} h de anticipación. Comunícate con el taller.` });
    }
    // fecha_cancelacion deja rastro del momento: es lo que hace visible la
    // cancelación en las alertas de recepción (antes la cita desaparecía en silencio).
    await req.db.query("UPDATE citas SET estado = 'cancelado', fecha_cancelacion = NOW() WHERE id = ? AND tenant_id = @tenant", [req.params.id]);
    res.json({ message: 'Cita cancelada' });
  } catch (err) {
    fail(res, err);
  }
});

// PATCH /api/portal/citas/:id/confirmar — el cliente confirma que asistirá.
// Marca confirmada_cliente=1 (el taller lo usa como señal de presencia / no-show).
router.patch('/citas/:id/confirmar', async (req, res) => {
  try {
    const [[cita]] = await req.db.query(
      'SELECT id, estado FROM citas WHERE tenant_id = @tenant AND id = ? AND cliente_id = ?',
      [req.params.id, req.cliente.id]
    );
    if (!cita) return res.status(404).json({ error: 'Cita no encontrada' });
    if (cita.estado !== 'agendado') {
      return res.status(400).json({ error: 'Solo se puede confirmar una cita agendada.' });
    }
    await req.db.query('UPDATE citas SET confirmada_cliente = 1 WHERE id = ? AND tenant_id = @tenant', [req.params.id]);
    res.json({ message: 'Asistencia confirmada' });
  } catch (err) {
    fail(res, err);
  }
});

// Solo permite aprobar/rechazar si la orden es del cliente y está esperando aprobación.
// Si el cliente ya había aprobado antes (total_aprobado), lo que decide ahora es un
// adicional: rechazarlo no anula lo que ya aprobó, el trabajo sigue sin el adicional.
async function actualizarAprobacion(db, ordenId, clienteId, decision, motivo) {
  const [[orden]] = await db.query(
    "SELECT id, total_aprobado FROM ordenes_trabajo WHERE tenant_id = @tenant AND id = ? AND cliente_id = ? AND estado = 'esperando_aprobacion'",
    [ordenId, clienteId]
  );
  if (!orden) return false;
  // La orden no debe quedar "esperando aprobación" después de la decisión:
  // aprobado → a trabajar (o esperar repuestos); rechazado → vuelve a diagnóstico.
  if (decision === 'aprobado') {
    await registrarAprobacion(db, ordenId);
  } else if (orden.total_aprobado !== null) {
    await registrarRechazoAdicional(db, ordenId, motivo);
  } else {
    await db.query(
      `UPDATE ordenes_trabajo
         SET aprobacion_cliente = 'rechazado', motivo_rechazo = ?,
             aprobado_por_cliente = 0, fecha_aprobacion = NOW()
       WHERE tenant_id = @tenant AND id = ?`,
      [motivo, ordenId]
    );
    await avanzarEstadoOrden(db, ordenId, 'diagnostico');
  }
  return true;
}

module.exports = router;
// Para poder probarla sin un token real de Google.
module.exports.unirConGoogle = unirConGoogle;
