require('dotenv').config();
const express = require('express');
const { fail } = require('./utils/responder');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const { testConnection } = require('./db/pool');
const { migrar } = require('./db/migrar');
const { verificarListaContraEsquema } = require('./db/tenant-db');
const { iniciarJobs } = require('./jobs/scheduler');
const { iniciarRefrescoEstados } = require('./utils/estado-tenant');
const { iniciarRefrescoLimites } = require('./utils/limites');
const { apiLimiter, authLimiter, adminLimiter } = require('./middleware/rate-limit');

const app = express();
const frontendDist = path.join(__dirname, '../../frontend/www');
const hasFrontend = fs.existsSync(path.join(frontendDist, 'index.html'));
const esProduccion = process.env.NODE_ENV === 'production' || hasFrontend;

// JWT_SECRET es obligatorio: sin él, firmar/verificar tokens es inseguro o rompe.
// En producción abortamos con un mensaje claro; en dev usamos un secreto efímero
// con aviso ruidoso para no frenar el trabajo local.
if (!process.env.JWT_SECRET) {
  if (esProduccion) {
    console.error('❌ Falta JWT_SECRET. Definí la variable de entorno antes de arrancar.');
    process.exit(1);
  }
  process.env.JWT_SECRET = 'dev-inseguro-no-usar-en-produccion';
  console.warn('⚠️  JWT_SECRET no definido: usando secreto de desarrollo (NO usar en producción).');
}

if (esProduccion) {
  if (!process.env.CORS_ORIGIN && !hasFrontend) {
    console.warn('⚠️  CORS_ORIGIN no definido en producción. Usando default restrictivo.');
  }
  // En Railway la conexión viene entera en DATABASE_URL (ver db/pool.js) y las DB_* no
  // existen. Antes se exigían igual, así que el aviso salía en cada arranque aunque la
  // base conectara bien, y un aviso que siempre sale deja de leerse.
  if (!process.env.DATABASE_URL && (!process.env.DB_HOST || !process.env.DB_NAME)) {
    console.warn('⚠️  Falta la conexión a la base: DATABASE_URL, o DB_HOST y DB_NAME.');
  }
}

// En producción la app va detrás del proxy de Railway (y, si se prende, del de
// Cloudflare): se confía en esos saltos para que req.ip sea la IP real del cliente,
// que es con la que cuenta el límite de intentos. Ver utils/proxy.js.
if (esProduccion) app.set('trust proxy', require('./utils/proxy').saltosDeProxy());

// No revelar el framework (Express manda "X-Powered-By" por defecto): menos pistas
// para un atacante que busca vulnerabilidades conocidas del stack.
app.disable('x-powered-by');

// Compresión gzip/brotli de las respuestas (JSON y estáticos). Recorta el ancho
// de banda de forma notable, sobre todo en listados.
app.use(compression());

// Headers de seguridad (sin dependencias externas).
// CSP: endurecido pero compatible con el SPA de Angular/Ionic. Se permite
// 'unsafe-inline' en script/style porque Ionic inyecta estilos inline y las
// ventanas de impresión (comprobantes/PDF, abiertas con window.open + document.write)
// usan un <script>window.print()</script> inline que heredaría este CSP. Aun así se
// bloquea lo más peligroso: orígenes externos de script, <object>/<embed>, secuestro
// de <base>, envío de formularios a terceros y el enmarcado del sitio (anti-clickjacking).
// Nota: solo afecta a la web servida por este server; la app nativa (Capacitor) carga
// sus propios assets y no recibe estas cabeceras.
// Google Fonts: index.html carga la hoja de estilos desde fonts.googleapis.com y
// las tipografías desde fonts.gstatic.com — se permiten explícitamente en style/font.
// Cloudflare Turnstile (captcha anti-bot): carga un script y un iframe desde
// challenges.cloudflare.com, y verifica por fetch. Se permite en script/frame/connect.
// Entrar con Google (botón de Google Identity Services): script, estilos, iframe y
// fetch a accounts.google.com.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://challenges.cloudflare.com https://accounts.google.com",
  "frame-src https://challenges.cloudflare.com https://accounts.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Content-Security-Policy', CSP);
  // Aísla el contexto de navegación pero deja funcionar los popups (impresión de comprobantes).
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  // El sitio web no usa cámara/micrófono/ubicación: se niegan por completo.
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (esProduccion) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// CORS: la app nativa (Capacitor) llama a la API desde un origen distinto
// (capacitor://localhost en iOS, https://localhost o http://localhost en Android),
// así que los headers CORS deben enviarse SIEMPRE — antes solo se aplicaban sin
// frontend embebido y la app instalada quedaba bloqueada por el WebView.
// La web servida por este mismo server es same-origin y no se ve afectada.
// CORS_ORIGIN admite orígenes extra separados por coma.
const ORIGENES_PERMITIDOS = new Set([
  'capacitor://localhost',  // iOS (WebView de Capacitor)
  'https://localhost',      // Android (androidScheme https, default de Capacitor)
  'http://localhost',       // Android (androidScheme http)
  'http://localhost:8100',  // ionic serve en desarrollo
  ...(process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean),
]);
app.use(cors((req, cb) => {
  // Sin header Origin (same-origin, curl, healthcheck) se permite sin emitir CORS.
  cb(null, { origin: (origin, cb2) => cb2(null, !origin || ORIGENES_PERMITIDOS.has(origin)) });
}));

// Las rutas de entrada (login, códigos, recuperación, contacto) no llevan sesión y solo
// reciben un correo y una clave. Con el tope general de 10 MB, cualquiera podía hacer
// que el servidor leyera megas por pedido sin haberse identificado.
const CUERPO_CHICO = [
  '/api/auth/login', '/api/auth/2fa', '/api/auth/recuperar',
  '/api/portal/login', '/api/portal/registro', '/api/portal/recuperar', '/api/portal/otp', '/api/portal/google',
  '/api/motiq/login', '/api/motiq/contacto', '/api/metricas',
];
app.use(CUERPO_CHICO, express.json({ limit: '50kb' }));
// El resto admite fotos en base64 (cada ruta valida tipo y tamaño de la suya).
app.use(express.json({ limit: '10mb' }));

// Health check exento del rate limiting (lo sondea la plataforma con frecuencia).
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Rate limiting: estricto en autenticación (fuerza bruta + bcrypt), general en el resto.
// Nota: del 2FA solo se limitan los endpoints sensibles. `/2fa/estado` es una
// lectura autenticada que se consulta al abrir el perfil — dentro de este limitador
// (30 req por IP / 15 min, compartido por todo el taller tras un mismo router) se
// agotaría con el uso normal y terminaría bloqueando logins legítimos.
app.use([
  '/api/auth/login', '/api/auth/2fa/verificar', '/api/auth/2fa/activar', '/api/auth/2fa/desactivar',
  '/api/portal/login', '/api/portal/registro', '/api/portal/recuperar', '/api/portal/otp',
], authLimiter);
app.use('/api', apiLimiter);
app.use('/api/admin', adminLimiter);

// El mecánico no recibe montos ni el teléfono del cliente en ninguna respuesta.
app.use('/api', require('./middleware/ocultar-al-mecanico'));

app.use('/api/auth',      require('./routes/auth.routes'));

// Las rutas propias del SaaS, que MS Motos no tenía. Van juntas y arriba para que
// se vea de un vistazo qué pertenece a la plataforma y qué al taller.
app.use('/api/motiq',      require('./routes/motiq.routes'));       // panel de la plataforma
app.use('/api/onboarding', require('./routes/onboarding.routes'));  // alta de un taller nuevo
app.use('/api/avisos',     require('./routes/avisos.routes'));      // avisos de Motiq a los talleres
app.use('/api/reportes',   require('./routes/reportes.routes'));    // reportes de falla hacia la plataforma
app.use('/api/vehiculos',  require('./routes/vehiculos.routes'));   // reemplaza a /api/motos
app.use('/api/marca',     require('./routes/marca.routes'));
app.use('/api/directorio', require('./routes/directorio.routes')); // buscador público de talleres
app.use('/api/clientes',  require('./routes/clientes.routes'));
app.use('/api/ordenes',   require('./routes/ordenes.routes'));
app.use('/api/citas',     require('./routes/citas.routes'));
app.use('/api/usuarios',  require('./routes/usuarios.routes'));
app.use('/api/dashboard', require('./routes/dashboard.routes'));
app.use('/api/garantias', require('./routes/garantias.routes'));
app.use('/api/inventario', require('./routes/inventario.routes'));
app.use('/api/portal',    require('./routes/portal.routes'));
app.use('/api/promos',    require('./routes/promos.routes'));
app.use('/api/mecanico',  require('./routes/mecanico.routes'));
app.use('/api/recepcion', require('./routes/recepcion.routes'));
app.use('/api/mensajeria', require('./routes/mensajeria.routes'));
app.use('/api/admin',     require('./routes/admin.routes'));
app.use('/api/metricas/web-vitals-publico', require('./routes/metricas-publico.routes'));
app.use('/api/metricas',  require('./routes/metricas.routes'));
app.use('/api/monitor',   require('./routes/monitor.routes')); // el vigilante de n8n (clave propia)

// Una dirección de la API que no existe responde 404 en JSON. Sin esto caía en la
// app (index.html con 200) y quien llamaba no se enteraba de que no existía.
app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado' }));

// Lo que se escapa de las rutas. Una foto demasiado pesada o un cuerpo que no es JSON
// no son fallas del servidor: se dicen como tales, para que se entienda qué pasó.
app.use('/api', (err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'El archivo es demasiado pesado' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Los datos llegaron mal formados' });
  fail(res, err);
});

if (hasFrontend) {
  // Los assets del build llevan el hash del contenido en el nombre
  // (main.b8e0610d56ade15b.js): si el contenido cambia, cambia el nombre. Por eso se
  // pueden cachear para siempre. Sin esto Express mandaba `max-age=0` y el navegador
  // revalidaba los ~31 archivos en CADA visita: un viaje de ida y vuelta por archivo
  // para que el servidor responda "no cambió".
  // index.html es la excepción y va sin caché: es el que apunta a los hashes nuevos,
  // así que si se cachea, un deploy no se ve hasta que venza.
  const UN_ANIO = 365 * 24 * 60 * 60;
  const CON_HASH = /\.[0-9a-f]{8,}\.(js|css)$/i;
  app.use(express.static(frontendDist, {
    setHeaders: (res, ruta) => {
      if (CON_HASH.test(ruta)) {
        res.setHeader('Cache-Control', `public, max-age=${UN_ANIO}, immutable`);
      } else if (ruta.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
  app.get('/{*path}', (req, res) => {
    // Mismo criterio para el index que sirve el enrutado del SPA.
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
  console.log('🌐 Sirviendo frontend desde', frontendDist);
} else {
  console.log('⚡ Modo desarrollo: frontend en http://localhost:8100');
}

// Lo que falle fuera de /api (una dirección mal formada, un archivo que no se pudo
// leer). Sin esto respondía Express, que fuera de NODE_ENV=production devuelve la traza
// con las rutas internas del servidor. Acá nunca sale más que una línea.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const estado = err.status >= 400 && err.status < 500 ? err.status : 500;
  if (estado === 500) console.error('Error fuera de la API:', err.stack || err.message || err);
  res.status(estado).type('text/plain').send(estado === 500 ? 'Error del servidor' : 'Solicitud no válida');
});

const PORT = process.env.PORT || 3000;

// Bajo cluster.js el primario ya migró y decide qué worker corre los jobs; en arranque
// suelto (`node src/server.js`) no hay nadie más, así que este proceso hace las dos cosas.
const bajoCluster = process.env.MIGRADO === '1';
const correrJobs = bajoCluster ? process.env.JOBS === '1' : true;

// Corre la auto-migración ANTES de aceptar requests, así no hay una ventana
// donde la base esté a medio migrar mientras el server ya responde.
(async () => {
  await testConnection();
  if (!bajoCluster) await migrar();
  // Después de migrar: avisa si alguna tabla con tenant_id quedó fuera de la lista
  // del guard (o al revés). Sin esto, una tabla nueva pasaría sin filtro por tenant
  // y el guard la dejaría entrar sin quejarse.
  await verificarListaContraEsquema();
  // Qué talleres están suspendidos y los límites de cada plan, antes de escuchar: sin
  // esto, tras un reinicio cualquier suspendido vuelve a trabajar y los topes no rigen.
  await iniciarRefrescoEstados();
  await iniciarRefrescoLimites();
  // Tareas de fondo (recordatorios de cita, no-show). Después de migrar, para que
  // las columnas que usan (recordatorio_enviado, no_show) ya existan.
  // Solo un proceso las programa: si no, cada cliente recibiría un correo por worker.
  if (correrJobs) iniciarJobs();
  app.listen(PORT, () => console.log(`🚀 Servidor en http://localhost:${PORT}${bajoCluster ? ` (worker ${process.pid}${correrJobs ? ', con jobs' : ''})` : ''}`));
})();
