// Cuántos proxies hay entre el visitante y la app, para que req.ip sea la IP REAL.
//
// Importa porque el límite de intentos (login, códigos, registro) cuenta por IP: si
// req.ip fuera la de un proxy, todos los visitantes compartirían un mismo contador y
// uno solo podría bloquear a los demás.
//
//   · Hoy (Railway solo):           visitante → Railway → app          = 1 salto.
//   · Con el proxy de Cloudflare:   visitante → Cloudflare → Railway → app = 2 saltos.
//
// Se configura con TRUST_PROXY_SALTOS. Antes de prender la nube naranja en Cloudflare,
// poner TRUST_PROXY_SALTOS=2 en Railway. Ojo: con 2, alguien que entre directo por el
// dominio de Railway (sin pasar por Cloudflare) podría inventar su IP; si se prende
// Cloudflare, conviene que el dominio *.up.railway.app no quede publicado.
function saltosDeProxy(valor = process.env.TRUST_PROXY_SALTOS) {
  if (valor === undefined || valor === '') return 1;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > 3) {
    console.warn(`⚠️  TRUST_PROXY_SALTOS="${valor}" no es válido (1 a 3). Se usa 1.`);
    return 1;
  }
  return n;
}

module.exports = { saltosDeProxy };
