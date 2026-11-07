// Limitadores de tasa por IP. Protegen el pool de conexiones y la CPU del proceso
// (sobre todo bcrypt en login) ante abuso o picos. Store en memoria: suficiente
// para una sola instancia; al escalar a varias, mover el store a Redis (ver SCALING.md).
const rateLimit = require('express-rate-limit');

// El store es por proceso. Con varios workers, una misma IP puede caer en cualquiera,
// así que el cupo efectivo sería el configurado MULTIPLICADO por la cantidad de
// workers — y el freno a la fuerza bruta del login se aflojaría en la misma
// proporción. Se reparte para que el límite visto desde afuera no cambie.
// (Es una aproximación: el reparto entre workers no es perfectamente parejo. La
// solución exacta es un store compartido en Redis — ver SCALING.md.)
const WORKERS = Math.max(1, Number(process.env.WEB_CONCURRENCY) || 1);
const porProceso = (total) => Math.max(1, Math.floor(total / WORKERS));

// Cupos configurables. Existen para las pruebas de carga: con los valores normales,
// una prueba desde una sola IP choca contra el limitador antes de acercarse al límite
// real del sistema, y terminaría midiendo el limitador en vez de la aplicación.
// Se exponen como número (no como un interruptor de "apagado") a propósito: un valor
// alto por error sigue siendo un límite, un `off` olvidado no protege nada.
const cupo = (env, pordefecto) => {
  const n = Number(process.env[env]);
  return Number.isFinite(n) && n > 0 ? n : pordefecto;
};

// General: toda la API. Generoso para no afectar el uso normal del SPA, pero
// frena un cliente que dispare miles de requests y sature la base.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,        // 1 minuto
  max: porProceso(cupo('RATE_API_MAX', 600)),       // 600 req/min por IP en total (~10/seg)
  standardHeaders: true,      // expone RateLimit-* headers
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Espera un momento e intenta de nuevo.' },
});

// Autenticación: login/registro/recuperar. Estricto porque son el blanco de
// fuerza bruta y cada intento corre bcrypt (caro en CPU).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutos
  max: porProceso(cupo('RATE_AUTH_MAX', 30)),        // 30 intentos por IP en la ventana, en total
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.' },
});

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: porProceso(cupo('RATE_ADMIN_MAX', 120)),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes al panel admin. Espera un momento.' },
});

// Consultas que llegan desde el sitio web (formulario público, sin sesión). Una
// persona real manda una, quizás dos; sin tope, un robot llenaría la bandeja del
// taller. El sitio muestra el mensaje tal cual.
const consultasLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,   // 1 hora
  max: porProceso(cupo('RATE_CONSULTAS_MAX', 6)),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Ya recibimos varias consultas desde tu conexión. Escríbenos por WhatsApp o intenta en una hora.' },
});

// Reseñas que se dejan desde el sitio web (también públicas y sin sesión). Una
// persona deja una, quizás dos si se equivocó; sin tope, un robot llenaría de
// basura la lista de pendientes por aprobar. El sitio muestra el mensaje tal cual.
const resenasLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,   // 1 hora
  max: porProceso(cupo('RATE_RESENAS_MAX', 5)),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Ya recibimos varias reseñas desde tu conexión. Intenta de nuevo en una hora.' },
});

module.exports = { apiLimiter, authLimiter, adminLimiter, consultasLimiter, resenasLimiter };
