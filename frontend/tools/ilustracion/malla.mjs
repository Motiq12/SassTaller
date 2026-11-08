// Sólidos de caras arbitrarias con la misma salida que `slabOf` y `lathe`, para
// pintarlos con `solidSvg`. El kit extruye plantas y tornea perfiles, pero una
// carrocería no es ninguna de las dos cosas: su sección cambia a lo largo del auto.
import { iso, pathOf } from "./iso-kit.mjs";
import { viewOf, toneOf, add3, sub3, mul3, dot3, unit3 } from "./lathe.mjs";

const CLAVE = (p) => p.map((v) => v.toFixed(2)).join(",");

function normalDe(cara) {
  let n = [0, 0, 0];
  for (let i = 0; i < cara.length; i++) {
    const a = cara[i];
    const b = cara[(i + 1) % cara.length];
    n = add3(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
  }
  return unit3(n);
}

const area2 = (pts) => pts.reduce((s, [x, y], i) => {
  const [u, v] = pts[(i + 1) % pts.length];
  return s + x * v - u * y;
}, 0);
const orientada = (pts) => (area2(pts) < 0 ? [...pts].reverse() : pts);

// Une segmentos sueltos en trazos continuos, para que las uniones salgan redondas.
function encadenar(segmentos, P) {
  const siguientes = new Map();
  segmentos.forEach((s, i) => {
    for (const k of [s[0], s[1]]) {
      if (!siguientes.has(k.clave)) siguientes.set(k.clave, []);
      siguientes.get(k.clave).push(i);
    }
  });
  const usado = new Set();
  const trazos = [];
  segmentos.forEach((_, inicio) => {
    if (usado.has(inicio)) return;
    usado.add(inicio);
    const trazo = [segmentos[inicio][0], segmentos[inicio][1]];
    for (;;) {
      const cola = trazo[trazo.length - 1];
      const prox = (siguientes.get(cola.clave) || []).find((i) => !usado.has(i));
      if (prox === undefined) break;
      usado.add(prox);
      trazo.push(segmentos[prox][0].clave === cola.clave ? segmentos[prox][1] : segmentos[prox][0]);
    }
    trazos.push(pathOf(trazo.map((v) => iso(v.p, P))));
  });
  return trazos.join("");
}

// `caras`: listas de puntos 3D. Se orientan hacia afuera respecto del centro del
// sólido, lo que alcanza para cuerpos casi convexos como estos.
export function malla(caras, P, { pliegue = 26, centro: dado } = {}) {
  const V = viewOf(P);
  const todos = caras.flat();
  const centro = dado ?? mul3(todos.reduce((s, p) => add3(s, p), [0, 0, 0]), 1 / todos.length);
  const buckets = [[], [], [], [], []];
  const fill = [];
  const aristas = new Map();
  for (const cara of caras) {
    let n = normalDe(cara);
    const c = mul3(cara.reduce((s, p) => add3(s, p), [0, 0, 0]), 1 / cara.length);
    if (dot3(n, sub3(c, centro)) < 0) n = mul3(n, -1);
    if (dot3(n, V) <= 1e-6) continue;
    const pts = orientada(cara.map((p) => iso(p, P)));
    const d = pathOf(pts, true);
    fill.push(d);
    buckets[toneOf(n, P)].push(d);
    cara.forEach((a, i) => {
      const b = cara[(i + 1) % cara.length];
      const [ka, kb] = [CLAVE(a), CLAVE(b)];
      if (ka === kb) return;
      const clave = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (!aristas.has(clave)) aristas.set(clave, { a: { clave: ka, p: a }, b: { clave: kb, p: b }, ns: [] });
      aristas.get(clave).ns.push(n);
    });
  }
  const borde = [];
  const quiebre = [];
  const limite = Math.cos((pliegue * Math.PI) / 180);
  for (const { a, b, ns } of aristas.values()) {
    if (ns.length === 1) borde.push([a, b]);
    else if (dot3(ns[0], ns[1]) < limite) quiebre.push([a, b]);
  }
  return {
    fill: fill.join(""),
    outline: encadenar(borde, P),
    crease: encadenar(quiebre, P),
    top: buckets[4].join(""),
    shades: buckets.slice(0, 4).map((l) => l.join("")),
    seamless: true,
  };
}

// Recorta un polígono [x, z] contra el semiplano donde f(p) >= 0, con f lineal.
export function recortar(poligono, f) {
  const out = [];
  poligono.forEach((a, i) => {
    const b = poligono[(i + 1) % poligono.length];
    const [fa, fb] = [f(a), f(b)];
    if (fa >= 0) out.push(a);
    if (fa >= 0 !== fb >= 0) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  });
  return out;
}

// Curva suave por puntos [x, y] con x creciente (Hermite con pendientes promediadas).
export function curva(puntos) {
  const n = puntos.length;
  const m = puntos.map(([x, y], i) => {
    const [x0, y0] = puntos[Math.max(0, i - 1)];
    const [x1, y1] = puntos[Math.min(n - 1, i + 1)];
    return (y1 - y0) / (x1 - x0);
  });
  return (x) => {
    if (x <= puntos[0][0]) return puntos[0][1];
    if (x >= puntos[n - 1][0]) return puntos[n - 1][1];
    let i = 0;
    while (puntos[i + 1][0] < x) i++;
    const [x0, y0] = puntos[i];
    const [x1, y1] = puntos[i + 1];
    const h = x1 - x0;
    const t = (x - x0) / h;
    return (2 * t ** 3 - 3 * t ** 2 + 1) * y0 + (t ** 3 - 2 * t ** 2 + t) * h * m[i] + (-2 * t ** 3 + 3 * t ** 2) * y1 + (t ** 3 - t ** 2) * h * m[i + 1];
  };
}
