// Envío de correos vía Resend (API HTTP, sin SMTP).
// Sin RESEND_API_KEY: fuera de producción simula el envío y escribe el correo (con el
// código, si lleva) en el registro, para poder probar los flujos en local. En producción
// (NODE_ENV=production) no simula: registra un error claro, SIN el contenido, y devuelve
// false. Nunca lanza.

const RESEND_API_URL = 'https://api.resend.com/emails';
const RESEND_DOMINIOS_URL = 'https://api.resend.com/domains';
const REMITENTE_DE_PRUEBA = 'Motiq <onboarding@resend.dev>';

// Logo de la cabecera. En un correo no sirve incrustar la imagen (Gmail y compañía
// descartan las data: URI), así que se enlaza desde el mismo dominio que sirve la app.
// La base se deduce sola: en Railway sale de RAILWAY_PUBLIC_DOMAIN, y cuando tengamos
// dominio propio basta con definir APP_URL. Sin base pública (desarrollo local) no se
// pone <img> y la cabecera queda como antes, en texto.
function baseUrlPublica() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return null;
}

// Se apunta a /api/marca/logo y no al archivo del bundle: ese endpoint devuelve el
// logo cargado desde la configuración (guardado como data URL, que en un correo no
// se puede usar) y, si no hay ninguno, redirige al que trae la app.
// El logo es el del taller que manda el correo, así que la URL tiene que decir cuál
// es: /api/marca/logo pasa por tenantPublico, que saca el taller del slug. Sin él
// responde 400 y el correo sale sin logo (por eso tenant-publico.js guarda
// req.tallerSlug — su comentario ya anticipaba este uso).
function logoUrl(slug) {
  if (process.env.MAIL_LOGO_URL) return process.env.MAIL_LOGO_URL;
  const base = baseUrlPublica();
  if (!base || !slug) return null;
  return `${base}/api/marca/logo?taller=${encodeURIComponent(slug)}`;
}

// Acento de los correos cuando el taller no eligió color: el navy de Motiq. Antes
// cada plantilla llevaba el rojo de MS Motos escrito a mano, así que el cliente de
// CUALQUIER taller recibía correos con los colores de otra empresa.
const ACENTO = '#1e3a5f';

// Normaliza lo que mandan las rutas (marcaDelTaller) a algo que las plantillas
// puedan usar siempre, aunque la consulta de configuración haya fallado.
function normalizarMarca(m) {
  const marca = typeof m === 'string' ? { nombre: m } : (m || {});
  const color = /^#[0-9a-fA-F]{6}$/.test(marca.color || '') ? marca.color : ACENTO;
  // Sin nombre se dice "el taller" y no el de ninguna empresa concreta.
  return { nombre: marca.nombre || 'El taller', slug: marca.slug || null, color };
}

// ─────────────────────────────────────────────────────────────
// Núcleo de envío. Todas las plantillas pasan por acá.
// Devuelve true si el correo salió (o si estamos en modo dev sin API key);
// false ante un rechazo/red, o sin API key en producción. Nunca lanza.
// ─────────────────────────────────────────────────────────────
const enProduccion = () => process.env.NODE_ENV === 'production';

// B-18: simular el envío escribe el código de un solo uso en el registro. En desarrollo
// sirve; en producción el registro lo lee más gente que el dueño de la cuenta, y un
// código de recuperación o de ingreso ahí es una puerta abierta. Por eso solo fuera de
// producción.
const ERROR_SIN_CLAVE = '❌ Falta RESEND_API_KEY en producción: los correos NO se están enviando. Definila en las variables del servidor.';

// Al arrancar: avisa una vez, fuerte, si producción quedó sin clave. No corta el
// arranque: sin correo la app sigue sirviendo, pero tiene que verse en el registro.
// Devuelve true si la configuración sirve para enviar o simular.
function revisarConfiguracionCorreo() {
  if (process.env.RESEND_API_KEY || !enProduccion()) return true;
  console.error(ERROR_SIN_CLAVE);
  return false;
}

async function enviarCorreo({ to, subject, html, devLog }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM || REMITENTE_DE_PRUEBA;

  if (!to) return false;

  if (!apiKey) {
    if (enProduccion()) {
      // Ni el destinatario ni el asunto ni el devLog: solo que no salió.
      console.error(ERROR_SIN_CLAVE);
      return false;
    }
    console.log(`📧 [DEV] ${devLog || `Email a ${to}: ${subject}`}`);
    return true;
  }

  // Aviso útil: con el remitente de prueba de Resend solo se entrega al correo dueño
  // de la cuenta. Para enviar a cualquier destinatario hay que verificar un dominio
  // y poner MAIL_FROM con una dirección de ese dominio.
  if (from.includes('resend.dev')) {
    console.warn('⚠️  MAIL_FROM usa el remitente de prueba (resend.dev): Resend SOLO entregará al correo verificado de la cuenta. Verificá un dominio y definí MAIL_FROM para enviar a cualquier cuenta.');
  }

  try {
    const resp = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    if (!resp.ok) {
      const detalle = await resp.text().catch(() => '');
      console.error(`⚠️  Resend rechazó el envío a ${to}:`, resp.status, detalle);
      if (resp.status === 403 || /testing|verify a domain|own email/i.test(detalle)) {
        console.error('   → Causa típica: dominio sin verificar en Resend. Verificá un dominio y definí MAIL_FROM (p. ej. "Motiq <no-reply@TU-DOMINIO>").');
      }
      return false;
    }
    return true;
  } catch (err) {
    console.error(`⚠️  Error enviando correo a ${to}:`, err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Plantillas (mismo lenguaje visual oscuro del taller).
// ─────────────────────────────────────────────────────────────

// Envoltorio común: tarjeta oscura con encabezado del taller.
function envoltorio(marca, titulo, cuerpoHtml) {
  const { nombre: rotulo, slug, color } = normalizarMarca(marca);
  const nombre = escapar(rotulo);
  const logo = logoUrl(slug);

  // El alt del logo lleva el nombre del taller con el mismo estilo que el rótulo de
  // texto: si el cliente de correo bloquea imágenes (Outlook lo hace por defecto),
  // la cabecera se sigue leyendo igual que antes en vez de quedar un hueco.
  const cabecera = logo
    ? `<img src="${logo}" width="72" height="72" alt="${nombre}"
           style="display:block;border:0;outline:none;text-decoration:none;width:72px;height:72px;
                  color:${color};font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">`
    : `<div style="color:${color};font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">${nombre}</div>`;

  return `
  <div style="background:#0a0a0a;padding:32px 0;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
    <div style="max-width:460px;margin:0 auto;background:#171717;border-radius:24px;overflow:hidden;border:1px solid #262626;">
      <div style="padding:24px 32px 8px;">
        ${cabecera}
        <h1 style="color:#fafafa;font-size:22px;margin:14px 0 6px;">${escapar(titulo)}</h1>
      </div>
      <div style="padding:4px 32px 30px;">${cuerpoHtml}</div>
    </div>
  </div>`;
}

function parrafo(texto) {
  return `<p style="color:#a3a3a3;font-size:14px;line-height:1.6;margin:0 0 12px;">${texto}</p>`;
}

// Escapa texto de usuario para no romper el HTML del correo.
function escapar(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function plantillaCodigo(nombre, codigo, marca) {
  const { color } = normalizarMarca(marca);
  const cuerpo = `
    ${parrafo(`Hola${nombre ? ' ' + escapar(nombre) : ''}, usa este código para restablecer tu contraseña. Vence en 10 minutos.`)}
    <div style="text-align:center;padding:12px 0 8px;">
      <div style="display:inline-block;background:#0a0a0a;border:1px solid ${color};border-radius:16px;padding:18px 28px;">
        <span style="color:#fafafa;font-size:38px;font-weight:700;letter-spacing:10px;font-family:'JetBrains Mono','Courier New',monospace;">${escapar(codigo)}</span>
      </div>
    </div>
    <p style="color:#737373;font-size:12px;line-height:1.5;margin:12px 0 0;">
      Si no pediste este cambio, puedes ignorar este correo. Nadie podrá cambiar tu contraseña sin este código.
    </p>`;
  return envoltorio(marca, 'Recupera tu contraseña', cuerpo);
}

function plantillaCodigoLogin(nombre, codigo, marca) {
  const { color } = normalizarMarca(marca);
  const cuerpo = `
    ${parrafo(`Hola${nombre ? ' ' + escapar(nombre) : ''}, usa este código para ingresar a tu cuenta. Vence en 10 minutos.`)}
    <div style="text-align:center;padding:12px 0 8px;">
      <div style="display:inline-block;background:#0a0a0a;border:1px solid ${color};border-radius:16px;padding:18px 28px;">
        <span style="color:#fafafa;font-size:38px;font-weight:700;letter-spacing:10px;font-family:'JetBrains Mono','Courier New',monospace;">${escapar(codigo)}</span>
      </div>
    </div>
    <p style="color:#737373;font-size:12px;line-height:1.5;margin:12px 0 0;">
      Si no intentaste ingresar, ignora este correo. Nadie puede entrar a tu cuenta sin este código.
    </p>`;
  return envoltorio(marca, 'Tu código de ingreso', cuerpo);
}

function plantillaCodigoVerificacion(nombre, codigo, marca) {
  const { color } = normalizarMarca(marca);
  const cuerpo = `
    ${parrafo(`Hola${nombre ? ' ' + escapar(nombre) : ''}, ¡bienvenido! Usa este código para confirmar tu correo y activar tu cuenta. Vence en 10 minutos.`)}
    <div style="text-align:center;padding:12px 0 8px;">
      <div style="display:inline-block;background:#0a0a0a;border:1px solid ${color};border-radius:16px;padding:18px 28px;">
        <span style="color:#fafafa;font-size:38px;font-weight:700;letter-spacing:10px;font-family:'JetBrains Mono','Courier New',monospace;">${escapar(codigo)}</span>
      </div>
    </div>
    <p style="color:#737373;font-size:12px;line-height:1.5;margin:12px 0 0;">
      Si no creaste esta cuenta, puedes ignorar este correo.
    </p>`;
  return envoltorio(marca, 'Confirma tu correo', cuerpo);
}

// Confirmación de la dirección NUEVA al cambiar el correo desde el perfil.
// Va dirigido a la dirección nueva: recibirlo es justamente la prueba de que existe.
function plantillaCambioCorreo(nombre, codigo, marca) {
  const { color } = normalizarMarca(marca);
  const cuerpo = `
    ${parrafo(`Hola${nombre ? ' ' + escapar(nombre) : ''}, pediste cambiar el correo de tu cuenta a esta dirección. Confirma con este código, que vence en 10 minutos.`)}
    <div style="text-align:center;padding:12px 0 8px;">
      <div style="display:inline-block;background:#0a0a0a;border:1px solid ${color};border-radius:16px;padding:18px 28px;">
        <span style="color:#fafafa;font-size:38px;font-weight:700;letter-spacing:10px;font-family:'JetBrains Mono','Courier New',monospace;">${escapar(codigo)}</span>
      </div>
    </div>
    <p style="color:#737373;font-size:12px;line-height:1.5;margin:12px 0 0;">
      Hasta que confirmes, tu cuenta sigue usando el correo anterior. Si no pediste este
      cambio, ignora este mensaje: sin el código no se cambia nada.
    </p>`;
  return envoltorio(marca, 'Confirma tu correo nuevo', cuerpo);
}

// Aviso a la dirección ANTERIOR de que alguien pidió mudar la cuenta. No lleva código:
// su único fin es que el dueño real se entere a tiempo si le robaron la sesión.
function plantillaAvisoCambioCorreo(nombre, emailNuevo, marca) {
  const { color } = normalizarMarca(marca);
  const cuerpo = `
    ${parrafo(`Hola${nombre ? ' ' + escapar(nombre) : ''}, se pidió cambiar el correo de tu cuenta a <strong style="color:#fafafa;">${escapar(emailNuevo)}</strong>.`)}
    ${parrafo('Si fuiste tú, no tienes que hacer nada: confirma con el código que enviamos a esa dirección.')}
    <div style="background:#0a0a0a;border:1px solid ${color};border-radius:16px;padding:16px 20px;margin:8px 0 4px;">
      <p style="color:#fafafa;font-size:14px;line-height:1.6;margin:0;">
        <strong>Si no fuiste tú</strong>, entra ya mismo y cambia tu contraseña: alguien podría
        tener acceso a tu cuenta. Mientras no se confirme, este correo sigue siendo el válido.
      </p>
    </div>`;
  return envoltorio(marca, 'Pidieron cambiar tu correo', cuerpo);
}

function plantillaRecordatorio({ nombre, hora, servicio, moto, sucursal, taller }) {
  const donde = sucursal ? ` en ${escapar(sucursal)}` : '';
  const cuerpo = `
    ${parrafo(`Hola${nombre ? ' ' + escapar(nombre) : ''}, te recordamos tu cita para <strong style="color:#fafafa;">mañana a las ${escapar(hora)}</strong>${donde}.`)}
    <div style="background:#0a0a0a;border:1px solid #262626;border-radius:16px;padding:16px 20px;margin:8px 0 12px;">
      <p style="color:#737373;font-size:12px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px;">Servicio</p>
      <p style="color:#fafafa;font-size:15px;margin:0 0 10px;">${escapar(servicio)}</p>
      <p style="color:#737373;font-size:12px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px;">Vehículo</p>
      <p style="color:#fafafa;font-size:15px;margin:0;">${escapar(moto)}</p>
    </div>
    ${parrafo('Si no puedes asistir, avísanos para reprogramar. ¡Te esperamos!')}`;
  return envoltorio(taller, 'Recordatorio de tu cita', cuerpo);
}

// Aviso de hito del servicio (lista para entrega / entregada).
function plantillaEstado({ nombre, titulo, mensaje, taller }) {
  const cuerpo = `
    ${parrafo(`Hola${nombre ? ' ' + escapar(nombre) : ''},`)}
    ${parrafo(escapar(mensaje))}
    ${parrafo('Gracias por confiar en nosotros.')}`;
  return envoltorio(taller, titulo, cuerpo);
}

// ─────────────────────────────────────────────────────────────
// API pública (una función por tipo de correo).
// ─────────────────────────────────────────────────────────────

async function enviarCodigoReset(email, nombre, codigo, marca) {
  return enviarCorreo({
    to: email,
    subject: 'Tu código para recuperar la contraseña',
    html: plantillaCodigo(nombre, codigo, marca),
    devLog: `Código de recuperación para ${email}: ${codigo}`,
  });
}

// Código de ingreso sin contraseña (OTP) para el portal del cliente.
async function enviarCodigoLogin(email, nombre, codigo, marca) {
  return enviarCorreo({
    to: email,
    subject: 'Tu código de ingreso',
    html: plantillaCodigoLogin(nombre, codigo, marca),
    devLog: `Código de ingreso para ${email}: ${codigo}`,
  });
}

// Código para confirmar el correo al auto-registrarse en el portal.
async function enviarCodigoVerificacion(email, nombre, codigo, marca) {
  return enviarCorreo({
    to: email,
    subject: 'Confirma tu correo',
    html: plantillaCodigoVerificacion(nombre, codigo, marca),
    devLog: `Código de verificación para ${email}: ${codigo}`,
  });
}

// Código a la dirección nueva para confirmar un cambio de correo desde el perfil.
async function enviarCodigoCambioCorreo(emailNuevo, nombre, codigo, marca) {
  return enviarCorreo({
    to: emailNuevo,
    subject: 'Confirma tu correo nuevo',
    html: plantillaCambioCorreo(nombre, codigo, marca),
    devLog: `Código de cambio de correo para ${emailNuevo}: ${codigo}`,
  });
}

// Aviso a la dirección anterior. Que falle no debe frenar el cambio: es informativo.
async function enviarAvisoCambioCorreo(emailAnterior, nombre, emailNuevo, marca) {
  return enviarCorreo({
    to: emailAnterior,
    subject: 'Pidieron cambiar el correo de tu cuenta',
    html: plantillaAvisoCambioCorreo(nombre, emailNuevo, marca),
    devLog: `Aviso de cambio de correo a ${emailAnterior} (nuevo: ${emailNuevo})`,
  });
}

// Recordatorio de la cita del día siguiente.
async function enviarRecordatorioCita(email, datos) {
  return enviarCorreo({
    to: email,
    subject: `Recordatorio: tu cita es mañana a las ${datos.hora}`,
    html: plantillaRecordatorio(datos),
    devLog: `Recordatorio de cita a ${email}: mañana ${datos.hora} (${datos.servicio})`,
  });
}

// Aviso al cliente de un hito de su servicio (listo / entregado).
async function enviarAvisoEstado(email, datos) {
  return enviarCorreo({
    to: email,
    subject: datos.titulo,
    html: plantillaEstado(datos),
    devLog: `Aviso "${datos.titulo}" a ${email}`,
  });
}

// Aviso AL TALLER de una consulta nueva desde el sitio web (cotización, contacto
// o repuesto). Va con lo esencial para contestar sin abrir el panel.
const TIPO_CONSULTA = { cotizacion: 'Cotización', contacto: 'Mensaje', repuesto: 'Repuesto' };
async function enviarAvisoConsulta(email, datos) {
  const tipo = TIPO_CONSULTA[datos.tipo] || 'Consulta';
  const filas = [
    ['Nombre', datos.nombre], ['Teléfono', datos.telefono], ['Correo', datos.email],
    ['Moto', datos.moto], ['Sede', datos.sucursal], ['Mensaje', datos.mensaje],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => parrafo(`<strong style="color:#fafafa;">${k}:</strong> ${escapar(v)}`))
    .join('');
  const panel = baseUrlPublica() ? parrafo(`Está también en el panel: ${escapar(baseUrlPublica())}/admin/web/consultas`) : '';
  return enviarCorreo({
    to: email,
    subject: `${tipo} desde el sitio web: ${[datos.moto, datos.nombre].filter(Boolean).join(' · ')}`,
    html: envoltorio(datos.taller, `${tipo} nueva desde el sitio`, filas + panel),
    devLog: `Aviso de consulta #${datos.id} (${datos.tipo}) a ${email}`,
  });
}

// Recordatorio de las consultas del sitio que hay que volver a contactar hoy.
async function enviarSeguimientosDelDia(email, { nombre, taller, consultas }) {
  const lista = consultas
    .map((c) => parrafo(`<strong style="color:#fafafa;">${escapar(c.nombre)}</strong>` +
      `${c.moto ? ' · ' + escapar(c.moto) : ''}${c.telefono ? ' · ' + escapar(c.telefono) : ''}`))
    .join('');
  const panel = baseUrlPublica() ? parrafo(`Están en el panel: ${escapar(baseUrlPublica())}/admin/web/consultas`) : '';
  const n = consultas.length;
  return enviarCorreo({
    to: email,
    subject: `Hoy toca volver a contactar a ${n} ${n === 1 ? 'persona' : 'personas'} del sitio web`,
    html: envoltorio(taller, 'Seguimientos de hoy', parrafo(`Hola${nombre ? ' ' + escapar(nombre) : ''}, quedaron agendadas para hoy:`) + lista + panel),
    devLog: `Seguimientos del día (${n}) a ${email}`,
  });
}

// Aviso AL TALLER de que el respaldo automático de la base falló. Sin esto, un
// respaldo roto pasa inadvertido hasta el día en que hace falta.
async function enviarAvisoRespaldoFallido(email, { taller, error }) {
  return enviarCorreo({
    to: email,
    subject: 'El respaldo automático de la base falló',
    html: envoltorio(taller, 'El respaldo de anoche no se hizo',
      parrafo('El sistema intentó respaldar la base de datos y no pudo. Mientras no se corrija, no se están guardando copias nuevas.')
      + parrafo(`<strong style="color:#fafafa;">Motivo:</strong> ${escapar(error)}`)
      + parrafo('Avisale a quien mantiene el sistema.')),
    devLog: `Aviso de respaldo fallido a ${email}: ${error}`,
  });
}

// ─────────────────────────────────────────────────────────────
// Estado del envío (Configuración → Correo de envío).
// ─────────────────────────────────────────────────────────────

// "MS Motos <avisos@msmotos.com>" → { direccion: 'avisos@msmotos.com', dominio: 'msmotos.com' }.
function partesDelRemitente(from) {
  const m = String(from || '').match(/<([^>]+)>/);
  const direccion = (m ? m[1] : String(from || '')).trim().toLowerCase();
  const arroba = direccion.lastIndexOf('@');
  return { direccion, dominio: arroba > 0 ? direccion.slice(arroba + 1) : null };
}

// Estado de Resend por nombre: lo que ve el panel.
const VERIFICACION = { verified: 'verificado', pending: 'pendiente', not_started: 'pendiente', failed: 'fallido', temporary_failure: 'fallido' };

// Qué remitente usa el sistema y si Resend puede entregar a cualquier correo. Nunca
// devuelve la API key. Para ver el dominio hace falta una clave con acceso completo:
// una que solo envía responde 401 `restricted_api_key`, y entonces se dice eso en vez
// de inventar un estado.
async function estadoCorreo() {
  const from = process.env.MAIL_FROM || REMITENTE_DE_PRUEBA;
  const { direccion, dominio } = partesDelRemitente(from);
  const estado = {
    configurado: !!process.env.RESEND_API_KEY,
    remitente: from,
    direccion,
    dominio,
    de_prueba: dominio === 'resend.dev',
    con_mail_from: !!process.env.MAIL_FROM,
    verificacion: null, // verificado | pendiente | fallido | no_agregado | sin_permiso | error
  };
  if (!estado.configurado || estado.de_prueba || !dominio) return estado;
  try {
    const resp = await fetch(RESEND_DOMINIOS_URL, {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      signal: AbortSignal.timeout(6000),
    });
    const cuerpo = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      estado.verificacion = resp.status === 401 && cuerpo?.name === 'restricted_api_key' ? 'sin_permiso' : 'error';
      return estado;
    }
    const d = (cuerpo.data || []).find((x) => String(x.name).toLowerCase() === dominio);
    estado.verificacion = d ? (VERIFICACION[d.status] || 'pendiente') : 'no_agregado';
  } catch (err) {
    console.error('⚠️  No se pudo consultar el dominio en Resend:', err.message);
    estado.verificacion = 'error';
  }
  return estado;
}

// Correo de prueba al propio administrador que lo pide.
async function enviarCorreoPrueba(email, { nombre, taller }) {
  return enviarCorreo({
    to: email,
    subject: 'Correo de prueba del sistema',
    html: envoltorio(taller, 'El correo funciona',
      parrafo(`Hola${nombre ? ' ' + escapar(nombre) : ''}: si estás leyendo esto, el sistema puede mandar correos a esta dirección.`)
      + parrafo('Lo pediste desde Configuración → Correo de envío. No hace falta responder.')),
    devLog: `Correo de prueba a ${email}`,
  });
}

// ─────────────────────────────────────────────────────────────
function envoltorioMotiq(titulo, cuerpoHtml) {
  return `
  <div style="background:#0a0a0a;padding:32px 0;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
    <div style="max-width:460px;margin:0 auto;background:#171717;border-radius:24px;overflow:hidden;border:1px solid #262626;">
      <div style="padding:24px 32px 8px;">
        <div style="color:#3b82f6;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Motiq</div>
        <h1 style="color:#fafafa;font-size:22px;margin:14px 0 6px;">${escapar(titulo)}</h1>
      </div>
      <div style="padding:4px 32px 30px;">${cuerpoHtml}</div>
    </div>
  </div>`;
}

// Faltan pocos días de prueba. Se manda una sola vez, con anticipación suficiente para
// que le dé tiempo a decidir sin sentirse apurado.
async function enviarAvisoTrial(email, { nombre, taller, dias }) {
  const cuerpo =
    parrafo(`Hola ${escapar(nombre || '')}, a la prueba de <b>${escapar(taller)}</b> le quedan <b>${dias} ${dias === 1 ? 'día' : 'días'}</b>.`) +
    parrafo('Cuando se acabe no perdés nada: tu taller sigue funcionando y tus datos quedan donde están. Pasás al plan gratuito, que incluye una sucursal y hasta dos usuarios.') +
    parrafo('Si sos más de dos o tenés varios locales, escribinos y lo vemos.');
  return enviarCorreo({
    to: email,
    subject: `Te quedan ${dias} ${dias === 1 ? 'día' : 'días'} de prueba en Motiq`,
    html: envoltorioMotiq('Tu prueba está por terminar', cuerpo),
    devLog: `Aviso de fin de prueba a ${email} (${taller}, ${dias} días)`,
  });
}

// La prueba terminó y la cuenta pasó al plan gratuito. El tono importa: no es una
// mala noticia ni un corte, y el correo tiene que dejarlo claro en la primera línea.
async function enviarAvisoPlanGratis(email, { nombre, taller }) {
  const cuerpo =
    parrafo(`Hola ${escapar(nombre || '')}, la prueba de <b>${escapar(taller)}</b> terminó y tu cuenta pasó al <b>plan gratuito</b>.`) +
    parrafo('No se borró nada y podés seguir trabajando igual: órdenes, clientes, vehículos y citas siguen sin límite, y tus clientes siguen entrando al portal.') +
    parrafo('Lo que cambia: una sucursal, hasta dos usuarios, y el portal vuelve a la marca de Motiq.') +
    parrafo('¿Necesitás más? Respondé este correo y lo arreglamos.');
  return enviarCorreo({
    to: email,
    subject: 'Tu prueba terminó — seguís adentro, en el plan gratuito',
    html: envoltorioMotiq('Pasaste al plan gratuito', cuerpo),
    devLog: `Aviso de paso a plan gratuito a ${email} (${taller})`,
  });
}

// Código para confirmar el correo del dueño del taller. Va con la marca de Motiq y no
// con la del taller: quien lo recibe es el dueño confirmando SU cuenta con nosotros.
async function enviarCodigoCorreoStaff(email, { nombre, codigo, minutos }) {
  const cuerpo =
    parrafo(`Hola ${escapar(nombre || '')}, este es el código para confirmar tu correo:`) +
    `<div style="margin:18px 0;padding:14px;border-radius:14px;background:#0a0a0a;border:1px solid #262626;
                 text-align:center;color:#fafafa;font-size:30px;font-weight:700;letter-spacing:8px;">${escapar(codigo)}</div>` +
    parrafo(`Vence en ${minutos} minutos.`) +
    parrafo('Es el correo con el que vas a recuperar tu contraseña si la perdés, así que conviene tenerlo confirmado.');
  return enviarCorreo({
    to: email,
    subject: `${codigo} es tu código de Motiq`,
    html: envoltorioMotiq('Confirmá tu correo', cuerpo),
    devLog: `Código de verificación de staff para ${email}: ${codigo}`,
  });
}

module.exports = {
  revisarConfiguracionCorreo,
  enviarAvisoTrial, enviarAvisoPlanGratis, enviarCodigoCorreoStaff,
  estadoCorreo, enviarCorreoPrueba, partesDelRemitente,
  enviarCorreo, enviarCodigoReset, enviarCodigoLogin, enviarCodigoVerificacion,
  enviarCodigoCambioCorreo, enviarAvisoCambioCorreo,
  enviarRecordatorioCita, enviarAvisoEstado, enviarAvisoConsulta, enviarSeguimientosDelDia,
  enviarAvisoRespaldoFallido,
};
