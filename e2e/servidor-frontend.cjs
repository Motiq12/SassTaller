// Servidor del frontend para la suite E2E, sin dependencias:
// 1) sirve el build de producción de Angular (frontend/www) con fallback SPA;
// 2) hace de proxy de /api hacia el backend (127.0.0.1:3201), para que el
//    frontend compilado (environment.prod.ts, apiUrl "/api") funcione
//    same-origin exactamente igual que en producción.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PUERTO = Number(process.env.PUERTO || 4310);
const DESTINO = process.env.DESTINO_API || 'http://127.0.0.1:3201';
const RAIZ = path.join(__dirname, '..', 'frontend', 'www');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

function servir(res, codigo, tipo, cuerpo) {
  res.writeHead(codigo, { 'content-type': tipo, 'cache-control': 'no-store' });
  res.end(cuerpo);
}

function servirArchivo(res, rutaAbs) {
  fs.readFile(rutaAbs, (err, contenido) => {
    if (err) return servir(res, 404, 'text/plain; charset=utf-8', 'No encontrado');
    servir(res, 200, MIME[path.extname(rutaAbs).toLowerCase()] || 'application/octet-stream', contenido);
  });
}

function proxyApi(req, res) {
  const destino = new URL(req.url, DESTINO);
  const pedido = http.request(
    {
      protocol: DESTINO.startsWith('https') ? 'https:' : 'http:',
      hostname: destino.hostname,
      port: destino.port || (DESTINO.startsWith('https') ? 443 : 80),
      method: req.method,
      path: destino.pathname + destino.search,
      headers: { ...req.headers, host: destino.host },
    },
    (respuesta) => {
      res.writeHead(respuesta.statusCode || 502, respuesta.headers);
      respuesta.pipe(res);
    }
  );
  pedido.on('error', () => {
    if (!res.headersSent) servir(res, 502, 'application/json; charset=utf-8', JSON.stringify({ error: 'El backend no responde' }));
    else res.end();
  });
  req.pipe(pedido);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PUERTO}`);

  // La API viaja íntegra al backend (métodos, cuerpo, encabezados y errores).
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return proxyApi(req, res);

  // Archivos estáticos con protección de escape de directorio y fallback SPA.
  const rutaRelativa = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  const rutaAbs = path.join(RAIZ, rutaRelativa);
  if (!rutaAbs.startsWith(RAIZ)) return servir(res, 403, 'text/plain; charset=utf-8', 'Prohibido');

  fs.stat(rutaAbs, (err, estado) => {
    if (!err && estado.isFile()) return servirArchivo(res, rutaAbs);
    if (!err && estado.isDirectory()) {
      const indice = path.join(rutaAbs, 'index.html');
      if (fs.existsSync(indice)) return servirArchivo(res, indice);
    }
    // Cualquier ruta de Angular (tiene extensión solo en assets reales).
    if (rutaRelativa.includes('.')) return servir(res, 404, 'text/plain; charset=utf-8', 'No encontrado');
    servirArchivo(res, path.join(RAIZ, 'index.html'));
  });
});

server.listen(PUERTO, '127.0.0.1', () => {
  console.log(`[e2e] frontend en http://127.0.0.1:${PUERTO} (build: ${RAIZ}, proxy /api -> ${DESTINO})`);
});
