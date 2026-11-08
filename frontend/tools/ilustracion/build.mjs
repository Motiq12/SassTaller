// Dibuja la bahía de taller que va de fondo en las pantallas de acceso de Motiq.
//
// Por qué un dibujo y no una fotografía: la que había vino con el código de MS
// Motos y era SU taller. En un producto que le alquila el sistema a muchos
// talleres, una foto de uno solo es la marca de un cliente puesta de fondo para
// todos. Un dibujo del oficio no es de nadie en particular y es de todos.
//
// El objeto: una bahía con elevador de dos postes y un vehículo arriba. Es la
// máquina que cualquiera reconoce al entrar a un taller, y la escena dice
// literalmente lo que dice el titular de la pantalla — "tu vehículo, en buenas
// manos": el auto no está apoyado en el piso, lo sostienen los cuatro tacos del
// elevador, que son la única pieza encendida del dibujo.
//
//   node frontend/tools/ilustracion/build.mjs
//
// Escribe frontend/src/assets/portal/taller-iso.svg, que es lo que se versiona.
// El kit está copiado al lado (iso-kit.mjs) para que esto se pueda volver a
// generar sin depender de nada instalado fuera del repo.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "./iso-kit.mjs";
// Piezas de revolución en CUALQUIER eje. El `cylinder` de iso-kit solo hace eje
// Z, y una rueda hecha con él es un disco acostado: el primer intento de este
// dibujo tenía cuatro tambores en vez de cuatro ruedas, y por eso el auto no se
// reconocía. Las ruedas van sobre el eje Y, que es el del tren delantero.
import * as G from "./lathe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SALIDA = join(HERE, "../../src/assets/portal/taller-iso.svg");

const ANCHO = 1160;
const ALTO = 800;

// El mismo negro del panel de acceso ($tinta en portal-login.page.scss). Va como
// fondo propio del SVG para que el archivo se vea igual abierto solo que puesto
// de fondo; antes el archivo suelto salía sobre blanco.
const TINTA = "#0b0d10";

// ── Mundo ──────────────────────────────────────────────────────────────────
// Una unidad ≈ un píxel de la cosa real. x e y en el piso, z hacia arriba.
const PISO = { x: -232, y: -150, w: 450, d: 300, r: 14 };

// ── Elevador de dos postes ──
const POSTE_X = -84;
const POSTE_Y = 92;                  // ± a cada lado
const COLUMNA = { w: 26, d: 26, r: 2 };
const COLUMNA_ALTO = 196;
const BASE = { w: 54, d: 54, r: 3 };
const BASE_ALTO = 5;
const CARRO_Z = 64;                  // altura a la que quedó el elevador
const CARRO_ALTO = 32;
const BRAZO_Z = CARRO_Z + 10;
const BRAZO_ALTO = 9;
const TACO_Z = BRAZO_Z + BRAZO_ALTO;

// Dónde apoya cada taco. Los brazos salen del poste y terminan acá, y el
// vehículo se apoya justo encima: es el contacto que cuenta la escena. Van
// adentro del ancho del auto (±38) porque en un elevador real los tacos tocan
// el refuerzo del piso, no el borde; puestos afuera quedaban como cuatro
// perillas sueltas al lado del vehículo, sin sostener nada.
const APOYO_DX = [-28, 38];
const APOYO_DY = 31;

// ── El vehículo: la pieza encendida ──
// Se arma en volúmenes escalonados y no en una caja: la caja no se lee como un
// auto. La clave para que se reconozca a esta cámara es que el habitáculo esté
// metido hacia adentro en los dos ejes (queda un hombro a los costados y un
// capó y un baúl por delante y por detrás) y que las ruedas cuelguen por fuera
// de la carrocería. Sin esas dos cosas vuelve a parecer cajas apiladas.
const VEH_Z = TACO_Z + 6;
const LARGO = 196;
const ANCHO_V = 76;
const VEH_X = POSTE_X - LARGO / 2 + 8;
const CUERPO = { x: VEH_X, y: -ANCHO_V / 2, w: LARGO, d: ANCHO_V, r: 11 };
const CUERPO_ALTO = 18;
const HOMBRO = 9;                    // cuánto se mete el habitáculo a los lados
const CAPO = { x: VEH_X + 5, y: -ANCHO_V / 2 + 4, w: 66, d: ANCHO_V - 8, r: 8 };
const CAPO_ALTO = 9;
const CABINA = { x: VEH_X + 72, y: -ANCHO_V / 2 + HOMBRO, w: 70, d: ANCHO_V - HOMBRO * 2, r: 13 };
const CABINA_ALTO = 27;
const BAUL = { x: VEH_X + 144, y: -ANCHO_V / 2 + 5, w: 46, d: ANCHO_V - 10, r: 8 };
const BAUL_ALTO = 15;
const TECHO = VEH_Z + CUERPO_ALTO + CABINA_ALTO;
const RUEDA_R = 13;
const RUEDA_ANCHO = 9;
const EJE_D = VEH_X + 40;            // eje delantero
const EJE_T = VEH_X + 152;           // eje trasero

// ── Mobiliario ──
const CARRO_H = { x: 116, y: -142, w: 68, d: 50, r: 3 };
const CARRO_H_ALTO = 88;
const BANCO = { x: 78, y: 96, w: 136, d: 44, r: 2 };
const BANCO_Z = 56;
const TAMBOR = { x: 196, y: -34, r: 19, alto: 56 };
const NEUMATICOS = { x: -198, y: -118, r: 25 };
const CABALLETES = [[-182, 86], [-128, 122]];

const P = k.fitProjection(
  [
    ...k.boxCorners(PISO, -9, 0),
    [POSTE_X, -POSTE_Y, COLUMNA_ALTO + 18],
    [POSTE_X, POSTE_Y, COLUMNA_ALTO + 18],
    [CUERPO.x + CUERPO.w, 0, TECHO],
    [CARRO_H.x + CARRO_H.w, CARRO_H.y, CARRO_H_ALTO],
    [BANCO.x + BANCO.w, BANCO.y + BANCO.d, BANCO_Z + 60],
    [NEUMATICOS.x, NEUMATICOS.y, 70],
  ],
  ANCHO,
  ALTO,
  { pad: 22, azimuth: 48, elevation: 24 },
);

const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (pts, style) => k.dotsSvg(pts, style);
const halo = (plan, z, h) => `<path class="iso-halo" d="${k.haloOf(plan, z, h, P)}"/>`;
const centrar = (cx, cy, plan) => ({ ...plan, x: cx - plan.w / 2, y: cy - plan.d / 2 });
const cuadro = (cx, cy, w, d, r = 1) => ({ x: cx - w / 2, y: cy - d / 2, w, d, r });
// Las piezas que se repiten se pintan de atrás hacia adelante.
const porFondo = (pts) => [...pts].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));

const piezas = [];
const poner = (...svg) => piezas.push(...svg);

// Tornillo: el anillo rebajado más el punto. Va en las esquinas de cada chapa,
// que es donde están en la cosa real.
function tornillos(plan, inset, z, r = 2.2) {
  const pts = k.corners(k.insetPlan(plan, inset), 0);
  return [
    L(pts.map(([x, y]) => k.ring(x, y, r, z, P, 14)).join(""), { tone: "lo" }),
    D(pts.map(([x, y]) => at([x, y, z])), { size: 0.48 }),
  ];
}

// Chapa de identificación: un rectángulo rebajado con tres renglones grabados.
// Las tres líneas son el convenio del kit para "acá dice algo" sin poner texto.
function chapa(plan, z, cara = "y") {
  const out = [S(k.slabOf(plan, z, 0.8, P, 1), { tone: "lo", crease: "none" })];
  for (let i = 0; i < 3; i++) {
    const t = plan.y + 3.4 + i * 3.2;
    out.push(L(k.segment([plan.x + 3, t, z + 0.8], [plan.x + plan.w - (i === 2 ? 11 : 3), t, z + 0.8], P), { tone: "faint", free: true }));
  }
  return out;
}

// ── 1. El piso ─────────────────────────────────────────────────────────────
function piso() {
  poner(halo(PISO, -9, 9));
  poner(S(k.slabOf(PISO, -9, 9, P, 12, 1.6), { tone: "lo" }));

  // Juntas de dilatación: de borde a borde, nunca cortadas en el medio.
  poner(L(k.planOutline(k.insetPlan(PISO, 18), 0, P), { tone: "faint" }));
  for (const y of [-58, 58]) {
    poner(L(k.segment([PISO.x + 18, y, 0], [PISO.x + PISO.w - 18, y, 0], P), { tone: "faint" }));
  }
  poner(L(k.segment([-6, PISO.y + 18, 0], [-6, PISO.y + PISO.d - 18, 0], P), { tone: "faint" }));

  // Demarcación pintada de la bahía: el rectángulo de trabajo alrededor del
  // elevador. Es lo que hace que el piso deje de ser una losa vacía.
  const bahia = { x: POSTE_X - 128, y: -POSTE_Y - 26, w: 252, d: (POSTE_Y + 26) * 2, r: 4 };
  poner(L(k.planOutline(bahia, 0.2, P), { tone: "lo" }));
  poner(L(k.planOutline(k.insetPlan(bahia, 4), 0.2, P), { tone: "faint" }));

  // Franja de seguridad a rayas en el borde de adelante: barras cerradas, no
  // rayas sueltas, para que cada una termine en su propio contorno.
  const franja = { x: PISO.x + 26, y: PISO.y + PISO.d - 26, w: 150, d: 11, r: 1 };
  poner(S(k.slabOf(franja, 0, 0.6, P, 1), { tone: "faint", crease: "none" }));
  for (let i = 0; i < 11; i++) {
    const b = { x: franja.x + 4 + i * 13, y: franja.y + 2, w: 6.5, d: franja.d - 4, r: 0.6 };
    poner(S(k.slabOf(b, 0.6, 0.4, P, 1), { tone: "lo", crease: "none" }));
  }

  // Regla grabada en el borde del fondo, con marca mayor cada cinco.
  const regla = { x: PISO.x + 30, y: PISO.y + 13, w: PISO.w - 60, d: 9, r: 1 };
  poner(S(k.slabOf(regla, 0, 0.7, P, 3), { tone: "lo", crease: "none" }));
  const t = k.topTicks(regla.x + 6, regla.x + regla.w - 6, 8, 5, regla.y + regla.d - 1, 0.7, [2.6, 5], P);
  poner(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }));

  // Rejilla del desagüe: ranuras cerradas con su marco, nunca líneas sueltas.
  const rej = { x: 36, y: 6, w: 58, d: 34, r: 2 };
  poner(S(k.slabOf(rej, -1.4, 1.4, P, 3), { tone: "faint" }));
  poner(L(k.planOutline(k.insetPlan(rej, 3), 1.4, P), { tone: "lo" }));
  for (let i = 0; i < 6; i++) {
    const ranura = { x: rej.x + 6 + i * 7.8, y: rej.y + 6, w: 3.6, d: rej.d - 12, r: 1.2 };
    poner(L(k.planOutline(ranura, 1.4, P), { tone: "lo" }));
  }

  // Anclajes del piso, en las cuatro esquinas.
  poner(...tornillos(k.insetPlan(PISO, 30), 0, 0, 3));
}

// ── 2. Un poste del elevador ───────────────────────────────────────────────
// Se dibuja entero (base, columna, trabas, carro, brazos y tacos) para poder
// pintar el de atrás antes del vehículo y el de adelante después.
function poste(ladoY, conMando) {
  const out = [];
  const dentro = ladoY > 0 ? -1 : 1;          // hacia el centro de la bahía
  const base = centrar(POSTE_X, ladoY, BASE);
  const col = centrar(POSTE_X, ladoY, COLUMNA);
  const xi = POSTE_X - COLUMNA.w / 2;          // cara izquierda de la columna
  const xd = POSTE_X + COLUMNA.w / 2;          // cara derecha

  out.push(halo(base, 0, BASE_ALTO));
  out.push(S(k.slabOf(base, 0, BASE_ALTO, P, 3, 0.9), { tone: "lo" }));
  out.push(...tornillos(base, 7, BASE_ALTO, 2.6));
  // Cartela que une la base con la columna: el triángulo de chapa de siempre.
  out.push(S(k.slabOf(centrar(POSTE_X, ladoY, { w: COLUMNA.w + 10, d: COLUMNA.d + 10, r: 2 }),
                      BASE_ALTO, 7, P, 2, 1.4), { tone: "lo" }));

  // La columna, con su canal frontal y las trabas de seguridad.
  out.push(S(k.slabOf(col, BASE_ALTO + 7, COLUMNA_ALTO - BASE_ALTO - 7, P, 2, 1), { tone: "mid" }));
  // Canal: dos líneas de borde a borde, no una sola suelta.
  for (const dx of [4.5, COLUMNA.w - 4.5]) {
    out.push(L(k.segment([xi + dx, ladoY - COLUMNA.d / 2, BASE_ALTO],
                         [xi + dx, ladoY - COLUMNA.d / 2, COLUMNA_ALTO], P), { tone: "faint" }));
  }
  // Escalera de trabas de seguridad. Los peldaños van ENTRE dos rieles y no de
  // borde a borde de la columna: terminados contra la silueta quedaban cortos
  // por el redondeo de la esquina, y alargados pasaban de largo y morían al
  // aire. Con los rieles cada peldaño termina sobre un trazo de verdad, que es
  // además como está hecha la cremallera real.
  const zTrabas = [];
  for (let z = BASE_ALTO + 22; z < COLUMNA_ALTO - 14; z += 12) zTrabas.push(z);
  const yRiel = COLUMNA.d / 2 - 3;
  for (const s of [-1, 1]) {
    out.push(L(k.segment([xi, ladoY + s * yRiel, zTrabas[0]],
                         [xi, ladoY + s * yRiel, zTrabas[zTrabas.length - 1]], P), { tone: "faint" }));
  }
  for (const z of zTrabas) {
    out.push(L(k.segment([xi, ladoY - yRiel, z], [xi, ladoY + yRiel, z], P), { tone: "lo" }));
  }
  out.push(L(k.sideSeam(col, COLUMNA_ALTO - 30, P), { tone: "faint" }));

  // Tapa superior con sus cuatro tornillos.
  const tapa = centrar(POSTE_X, ladoY, { w: COLUMNA.w + 8, d: COLUMNA.d + 8, r: 2 });
  out.push(S(k.slabOf(tapa, COLUMNA_ALTO, 4.5, P, 2, 0.7), { tone: "lo" }));
  out.push(...tornillos(tapa, 5.5, COLUMNA_ALTO + 4.5, 1.8));

  // El carro que sube, abrazando la columna.
  const carro = centrar(POSTE_X, ladoY, { w: COLUMNA.w + 14, d: COLUMNA.d + 14, r: 2.5 });
  out.push(S(k.slabOf(carro, CARRO_Z, CARRO_ALTO, P, 2, 1), { tone: "hi" }));
  out.push(L(k.planOutline(k.insetPlan(carro, 4.5), CARRO_Z + CARRO_ALTO, P), { tone: "lo" }));
  out.push(L(k.sideSeam(carro, CARRO_Z + CARRO_ALTO / 2, P), { tone: "faint" }));
  // Rodillos, uno arriba y otro abajo, y el trinquete de la traba.
  for (const z of [CARRO_Z + 6, CARRO_Z + CARRO_ALTO - 6]) {
    out.push(S(k.cylinder(xd + 6, ladoY, 3.6, z - 2.8, 5.6, P, 18), { tone: "mid" }));
    out.push(L(k.ring(xd + 6, ladoY, 1.8, z + 2.8, P, 12), { tone: "lo" }));
  }
  out.push(S(k.slabOf(centrar(xi - 5, ladoY, { w: 9, d: 11, r: 1 }), CARRO_Z + 11, 8, P, 1, 0.5), { tone: "mid" }));

  // Los dos brazos, cada uno en dos tramos telescópicos, hasta su taco.
  for (const dx of APOYO_DX) {
    const x0 = POSTE_X + (dx < 0 ? -8 : 8);
    const x1 = POSTE_X + dx;
    const y0 = ladoY + dentro * 12;
    const y1 = ladoY + dentro * APOYO_DY;
    // Tramo de la raíz, pegado al carro.
    const raiz = {
      x: Math.min(x0, x1 + (dx < 0 ? 10 : -10)), y: Math.min(y0, y0 + dentro * 26),
      w: Math.abs(x1 - x0) * 0.55 + 16, d: 26, r: 3,
    };
    out.push(S(k.slabOf(raiz, BRAZO_Z, BRAZO_ALTO, P, 3, 0.8), { tone: "mid" }));
    // Tramo extensible: más angosto, sale del anterior y llega al taco.
    const ext = {
      x: Math.min(x1 - 9, raiz.x + raiz.w - 6), y: Math.min(y1, y0) - 1,
      w: Math.abs(x1 - 9 - (raiz.x + raiz.w - 6)) + 18, d: Math.abs(y1 - y0) + 11, r: 3,
    };
    out.push(S(k.slabOf(ext, BRAZO_Z + 1, BRAZO_ALTO - 2, P, 3, 0.6), { tone: "mid" }));
    out.push(L(k.planOutline(k.insetPlan(ext, 3), BRAZO_Z + BRAZO_ALTO - 1, P), { tone: "faint" }));
    // Perno del pivote, donde el brazo nace del carro.
    out.push(L(k.ring(x0, y0, 3.4, BRAZO_Z + BRAZO_ALTO, P, 14), { tone: "lo" }));
    out.push(D([at([x0, y0, BRAZO_Z + BRAZO_ALTO])], { size: 0.6 }));

    // El taco: plato roscado, goma y corona. Queda debajo del auto, que es
    // donde va: se ve el del lado de acá y se intuye el de atrás.
    out.push(S(k.cylinder(x1, y1, 10, TACO_Z - 4, 4, P, 24, 0.6), { tone: "lo" }));
    out.push(L(k.ring(x1, y1, 10, TACO_Z - 4, P, 24), { tone: "faint" }));
    out.push(L(k.knurl(x1, y1, 10, TACO_Z - 4, TACO_Z, 14, P, 0.5), { tone: "faint" }));
    out.push(S(k.cylinder(x1, y1, 8.4, TACO_Z, 6, P, 24, 0.8), { tone: "hi" }));
    out.push(L(k.ring(x1, y1, 5, TACO_Z + 6, P, 20), { tone: "lo" }));
  }

  // El mando va en un solo poste, como en los de verdad.
  if (conMando) {
    const caja = centrar(POSTE_X + 34, ladoY, { w: 28, d: 22, r: 2 });
    const zc = 100;
    out.push(S(k.slabOf(caja, zc, 36, P, 2, 0.8), { tone: "hi" }));
    out.push(L(k.planOutline(k.insetPlan(caja, 3.8), zc + 36, P), { tone: "lo" }));
    out.push(...chapa({ x: caja.x + 4, y: caja.y + 4, w: caja.w - 8, d: 12, r: 0.6 }, zc + 36));
    const bot = [[caja.x + 8, caja.y + 18], [caja.x + 15, caja.y + 18], [caja.x + 22, caja.y + 18]];
    out.push(L(bot.map(([x, y]) => k.ring(x, y, 2.4, zc + 36, P, 12)).join(""), { tone: "lo" }));
    out.push(D(bot.map(([x, y]) => at([x, y, zc + 36])), { size: 0.8 }));
    // Soporte que lo cuelga de la columna, para que no quede flotando.
    out.push(S(k.slabOf({ x: xd, y: ladoY - 4, w: caja.x - xd + 2, d: 8, r: 1 }, zc + 12, 7, P, 1, 0.4), { tone: "lo" }));
    // Manguera: baja por la columna y termina en la base, con su punta marcada.
    out.push(L(k.segment([caja.x + 2, ladoY, zc + 4], [xd + 2, ladoY, zc - 16], P), { tone: "lo" }));
    out.push(L(k.segment([xd + 2, ladoY, zc - 16], [xd + 2, ladoY, BASE_ALTO + 10], P), { tone: "lo" }));
    out.push(L(k.segment([xd + 2, ladoY, BASE_ALTO + 10], [xd - 3, ladoY, BASE_ALTO + 4], P), { tone: "lo" }));
    out.push(D([at([xd - 3, ladoY, BASE_ALTO + 4])], { size: 0.6 }));
  }
  return out;
}

// Travesaño de arriba, que une las dos columnas, con su bandeja de cables.
function travesano() {
  const t = { x: POSTE_X - 8, y: -POSTE_Y, w: 16, d: POSTE_Y * 2, r: 2 };
  poner(S(k.slabOf(t, COLUMNA_ALTO - 13, 13, P, 2, 0.8), { tone: "mid" }));
  // Bandeja de cables: dos líneas de punta a punta y los soportes en el medio.
  for (const dx of [4, 12]) {
    poner(L(k.segment([t.x + dx, -POSTE_Y, COLUMNA_ALTO], [t.x + dx, POSTE_Y, COLUMNA_ALTO], P), { tone: "faint" }));
  }
  for (const y of [-52, 0, 52]) {
    poner(L(k.segment([t.x, y, COLUMNA_ALTO - 13], [t.x + 16, y, COLUMNA_ALTO - 13], P), { tone: "faint" }));
  }
  // Cartelas en los dos extremos, donde el travesaño se apoya en las columnas.
  for (const y of [-POSTE_Y + 10, POSTE_Y - 10]) {
    poner(S(k.slabOf(centrar(POSTE_X, y, { w: 22, d: 14, r: 1.5 }), COLUMNA_ALTO - 18, 5, P, 1, 0.5), { tone: "lo" }));
  }
}

// ── 3. El vehículo ─────────────────────────────────────────────────────────
// Una rueda: cuerpo de revolución sobre el eje Y, con su banda de rodamiento,
// la llanta hundida y los bulones. Las del lado de acá muestran la cara; las
// del fondo solo asoman por debajo de la carrocería, que es lo que se ve.
const RUEDA_Z = () => VEH_Z + 5;
function rueda(x, y) {
  const cerca = y > 0;
  const w = RUEDA_ANCHO / 2;
  const z = RUEDA_Z();
  const F = G.frameAlong([x, y, z], [0, 1, 0]);
  const cara = cerca ? w : -w;              // la cara que mira al observador
  const signo = cerca ? 1 : -1;

  // Cubierta, con el hombro redondeado y la banda de rodamiento.
  poner(S(G.solidOf([[-w, RUEDA_R - 2.2], [-w + 2, RUEDA_R], [w - 2, RUEDA_R], [w, RUEDA_R - 2.2]], F, P),
          { tone: "mid" }));
  poner(L(G.ribsOf(F, -w + 2.5, w - 2.5, RUEDA_R, 26, P, { least: 0.1, seams: true }), { tone: "faint" }));
  poner(L(G.circleOf(F, cara - signo * 0.6, RUEDA_R - 1.5, P), { tone: "lo" }));

  // Llanta: hundida respecto del flanco, con su pestaña y el centro.
  poner(S(G.disc(cara - signo * 3.4, cara - signo * 1.2, RUEDA_R - 6.5, F, P), { tone: "hi" }));
  poner(L(G.circleOf(F, cara - signo * 1.2, RUEDA_R - 9.5, P), { tone: "lo" }));
  poner(S(G.disc(cara - signo * 2.2, cara - signo * 0.8, 4.2, F, P), { tone: "hi" }));
  // Radios y bulones, solo donde se ven.
  if (cerca) {
    poner(L(G.spokesOf(F, cara - signo * 1.3, 5.2, RUEDA_R - 8.2, 5, P, { phase: 0.35 }), { tone: "lo" }));
    poner(D(G.dotsOf(F, cara - signo * 0.7, 6.6, 5, P, { phase: 0.35 }), { size: 0.42 }));
  }
}

function vehiculo() {
  // Las ruedas cuelgan: el auto está levantado y no toca el piso. Se pintan las
  // de atrás primero para que la carrocería tape su mitad superior.
  const ejes = porFondo([[EJE_D, -36], [EJE_D, 36], [EJE_T, -36], [EJE_T, 36]]);
  for (const [x, y] of ejes.slice(0, 2)) rueda(x, y);

  // Carrocería: la pieza baja que une todo.
  poner(S(k.slabOf(CUERPO, VEH_Z, CUERPO_ALTO, P, 12, 2), { tone: "hi", lit: true, halo: true }));
  // Zócalo y la línea de cintura, de punta a punta del costado.
  poner(L(k.planOutline(k.insetPlan(CUERPO, 5), VEH_Z + CUERPO_ALTO, P), { tone: "lo" }));
  poner(L(k.sideSeam(CUERPO, VEH_Z + 7, P, 12), { tone: "faint" }));
  // Pasarruedas: el arco sobre cada rueda, apoyado en el costado.
  for (const x of [EJE_D, EJE_T]) {
    for (const s of [-1, 1]) {
      poner(L(k.sideArc(x, (ANCHO_V / 2) * s, RUEDA_R + 3.5, VEH_Z + 1, P, 18), { tone: "faint" }));
    }
  }

  // Capó, habitáculo y baúl.
  poner(S(k.slabOf(CAPO, VEH_Z + CUERPO_ALTO, CAPO_ALTO, P, 9, 1.6), { tone: "hi", lit: true }));
  poner(S(k.slabOf(BAUL, VEH_Z + CUERPO_ALTO, BAUL_ALTO, P, 9, 1.6), { tone: "hi", lit: true }));
  poner(S(k.slabOf(CABINA, VEH_Z + CUERPO_ALTO, CABINA_ALTO, P, 14, 2.4), { tone: "hi", lit: true }));

  const zCapo = VEH_Z + CUERPO_ALTO + CAPO_ALTO;
  const zBaul = VEH_Z + CUERPO_ALTO + BAUL_ALTO;

  // Parabrisas y luneta: el vidrio inclinado se dibuja como la cara superior
  // rebajada del habitáculo, cruzándolo de lado a lado.
  poner(L(k.planOutline(k.insetPlan(CABINA, 8), TECHO, P), { tone: "faint" }));
  for (const dx of [11, CABINA.w - 11]) {
    poner(L(k.segment([CABINA.x + dx, CABINA.y + 4, TECHO], [CABINA.x + dx, CABINA.y + CABINA.d - 4, TECHO], P), { tone: "lo" }));
  }
  // Montantes y corte de las puertas: de techo a carrocería, en los dos costados.
  for (const s of [-1, 1]) {
    const yc = CABINA.y + (s > 0 ? CABINA.d : 0);
    for (const dx of [11, CABINA.w / 2, CABINA.w - 11]) {
      poner(L(k.segment([CABINA.x + dx, yc, TECHO], [CABINA.x + dx, yc, VEH_Z + CUERPO_ALTO], P), { tone: "lo" }));
    }
    // Línea de ventanilla: cruza el costado de montante a montante. Con los
    // montantes verticales ya dibujados, cierra dos paños de vidrio a cada
    // lado; sin ella el habitáculo seguía leyéndose como una caja lisa.
    poner(L(k.segment([CABINA.x + 11, yc, TECHO - 11], [CABINA.x + CABINA.w - 11, yc, TECHO - 11], P), { tone: "lo" }));
    // Y el vidrio queda rebajado respecto del techo: el escalón del marco.
    poner(L(k.segment([CABINA.x + 11, yc, TECHO - 2.5], [CABINA.x + CABINA.w - 11, yc, TECHO - 2.5], P), { tone: "faint" }));
    // Corte de la puerta siguiendo hacia abajo por la carrocería.
    poner(L(k.segment([CABINA.x + CABINA.w / 2, (ANCHO_V / 2) * s, VEH_Z + CUERPO_ALTO],
                      [CABINA.x + CABINA.w / 2, (ANCHO_V / 2) * s, VEH_Z + 7], P), { tone: "faint" }));
    // Manija, apoyada en la línea de cintura.
    poner(D([at([CABINA.x + CABINA.w / 2 + 13, (ANCHO_V / 2) * s, VEH_Z + CUERPO_ALTO - 4])], { size: 0.7 }));
    // Espejo: cuelga del montante delantero a la altura de la cintura, pegado
    // al hombro de la carrocería. Puesto más arriba se leía como una caja
    // apoyada en el techo, que es justo lo que el dibujo no tiene que parecer.
    //
    // Solo el de este lado. El del lado de allá queda detrás del habitáculo a
    // esta cámara, y como este bloque se pinta DESPUÉS de la cabina, dibujarlo
    // lo ponía encima del techo: un cubo flotando sobre el auto.
    if (s > 0) {
      const ym = CABINA.y + CABINA.d + 4;
      const zm = VEH_Z + CUERPO_ALTO + 4;
      poner(S(k.slabOf(cuadro(CABINA.x + 9, ym, 8, 4, 1.2), zm, 3.6, P, 2, 0.4), { tone: "mid" }));
      // Brazo del espejo: nace en el montante y termina en el espejo.
      poner(L(k.segment([CABINA.x + 13, CABINA.y + CABINA.d, zm + 1.8],
                        [CABINA.x + 9, ym, zm + 1.8], P), { tone: "lo" }));
    }
  }

  // Trompa: parrilla con sus barras y los faros, todo sobre la cara del capó.
  for (let i = 0; i < 3; i++) {
    poner(L(k.segment([CAPO.x, CAPO.y - 1, zCapo - 2 - i * 2.6], [CAPO.x, CAPO.y + CAPO.d + 1, zCapo - 2 - i * 2.6], P), { tone: "faint" }));
  }
  poner(L(k.segment([CAPO.x, CAPO.y + CAPO.d / 2, zCapo], [CAPO.x + CAPO.w, CAPO.y + CAPO.d / 2, zCapo], P), { tone: "faint" }));
  for (const s of [-1, 1]) {
    const yf = CAPO.y + CAPO.d / 2 + s * (CAPO.d / 2 - 11);
    poner(S(k.slabOf(cuadro(CAPO.x + 5, yf, 8, 13, 2), zCapo - 5, 4, P, 2, 0.5), { tone: "hi" }));
    poner(D([at([CAPO.x + 5, yf, zCapo - 1])], { size: 0.8 }));
    // Ópticas traseras.
    poner(S(k.slabOf(cuadro(BAUL.x + BAUL.w - 4, CAPO.y + CAPO.d / 2 + s * (BAUL.d / 2 - 9), 6, 11, 1.5), zBaul - 5, 4, P, 2, 0.4), { tone: "mid" }));
  }
  // Tapa del baúl y del capó: una línea rebajada que cruza cada una entera.
  poner(L(k.planOutline(k.insetPlan(CAPO, 6), zCapo, P), { tone: "faint" }));
  poner(L(k.planOutline(k.insetPlan(BAUL, 6), zBaul, P), { tone: "faint" }));

  for (const [x, y] of ejes.slice(2)) rueda(x, y);
}

// ── 4. Carro de herramientas ───────────────────────────────────────────────
function carroHerramientas() {
  const c = CARRO_H;
  const yf = c.y + c.d;                       // cara de los cajones
  poner(halo(c, 8, CARRO_H_ALTO));
  // Ruedas giratorias con su horquilla.
  for (const [x, y] of porFondo(k.corners(k.insetPlan(c, 9), 0))) {
    poner(S(k.slabOf(cuadro(x, y, 7, 7, 1), 7, 4, P, 1, 0.3), { tone: "lo" }));
    poner(S(k.cylinder(x, y, 4, 0, 7, P, 16, 0.6), { tone: "lo" }));
    poner(L(k.ring(x, y, 1.6, 7, P, 10), { tone: "faint" }));
  }
  // Cuerpo.
  poner(S(k.slabOf(c, 8, CARRO_H_ALTO - 8, P, 3, 1.2), { tone: "mid" }));
  poner(L(k.sideSeam(c, 12, P), { tone: "faint" }));

  // Los cajones: cada frente es una chapa rebajada con su tirador en relieve.
  const alturas = [17, 14, 14, 12, 12, 11];
  let z = 13;
  for (const alto of alturas) {
    const frente = { x: c.x + 3.5, y: yf - 1.6, w: c.w - 7, d: 1.6, r: 0.8 };
    poner(S(k.slabOf(frente, z, alto - 3.2, P, 1, 0.4), { tone: "hi", crease: "none" }));
    // Tirador: un volumen, no una raya.
    const tir = { x: c.x + 16, y: yf - 0.6, w: c.w - 32, d: 2.4, r: 1 };
    poner(S(k.slabOf(tir, z + alto - 10, 3.4, P, 1, 0.4), { tone: "lo", crease: "none" }));
    z += alto;
  }
  // Tapa de trabajo, apenas volada, con su borde y sus tornillos.
  const tapa = { x: c.x - 2.5, y: c.y - 2.5, w: c.w + 5, d: c.d + 5, r: 3 };
  poner(S(k.slabOf(tapa, CARRO_H_ALTO, 4, P, 3, 0.9), { tone: "hi" }));
  poner(L(k.planOutline(k.insetPlan(tapa, 5), CARRO_H_ALTO + 4, P), { tone: "faint" }));
  poner(...chapa({ x: c.x + 8, y: c.y + 6, w: 26, d: 11, r: 0.6 }, CARRO_H_ALTO + 4));
  // Manija de empuje en el costado.
  const mx = c.x + c.w + 3;
  poner(S(k.cylinder(mx, c.y + 10, 1.8, CARRO_H_ALTO - 16, 14, P, 10), { tone: "lo" }));
  poner(S(k.cylinder(mx, c.y + c.d - 10, 1.8, CARRO_H_ALTO - 16, 14, P, 10), { tone: "lo" }));
  poner(L(k.segment([mx, c.y + 10, CARRO_H_ALTO - 2], [mx, c.y + c.d - 10, CARRO_H_ALTO - 2], P), { tone: "mid" }));
  poner(D([at([mx, c.y + 10, CARRO_H_ALTO - 2]), at([mx, c.y + c.d - 10, CARRO_H_ALTO - 2])], { size: 0.5 }));
}

// ── 5. Banco de trabajo con prensa y panel ─────────────────────────────────
function banco() {
  const b = BANCO;
  poner(halo(b, 0, BANCO_Z));
  // Patas de perfil, con pie y travesaño.
  for (const [x, y] of porFondo(k.corners(k.insetPlan(b, 7), 0))) {
    poner(S(k.slabOf(cuadro(x, y, 11, 11, 1), 2.5, BANCO_Z - 8.5, P, 1, 0.5), { tone: "lo" }));
    poner(S(k.slabOf(cuadro(x, y, 15, 15, 1), 0, 2.5, P, 1, 0.4), { tone: "lo" }));
  }
  // Estante bajo, con su reborde.
  const estante = k.insetPlan(b, 9);
  poner(S(k.slabOf(estante, 16, 2.6, P, 2, 0.5), { tone: "lo" }));
  poner(L(k.planOutline(k.insetPlan(estante, 3), 18.6, P), { tone: "faint" }));
  // Dos cajas guardadas abajo, para que el estante no quede vacío.
  poner(S(k.slabOf({ x: estante.x + 8, y: estante.y + 6, w: 30, d: estante.d - 12, r: 1 }, 18.6, 13, P, 1, 0.5), { tone: "lo" }));
  poner(S(k.slabOf({ x: estante.x + 44, y: estante.y + 7, w: 22, d: estante.d - 14, r: 1 }, 18.6, 10, P, 1, 0.5), { tone: "lo" }));

  // Tapa: tablero grueso con su canto.
  poner(S(k.slabOf(b, BANCO_Z - 7, 7, P, 2, 1.2), { tone: "mid" }));
  poner(L(k.planOutline(k.insetPlan(b, 4.5), BANCO_Z, P), { tone: "faint" }));
  // Vetas del tablero: tres líneas de punta a punta.
  for (const dy of [12, 22, 32]) {
    poner(L(k.segment([b.x - 1, b.y + dy, BANCO_Z], [b.x + b.w + 1, b.y + dy, BANCO_Z], P), { tone: "faint" }));
  }

  // Prensa atornillada en la punta: cuerpo, mordazas, husillo y manija.
  const px = b.x + 20;
  const py = b.y + b.d / 2;
  poner(S(k.slabOf(cuadro(px, py, 20, 16, 1.5), BANCO_Z, 6, P, 2, 0.6), { tone: "mid" }));
  poner(S(k.slabOf(cuadro(px - 3, py, 7, 16, 1), BANCO_Z + 6, 11, P, 1, 0.5), { tone: "hi" }));
  poner(S(k.slabOf(cuadro(px + 7, py, 6, 16, 1), BANCO_Z + 6, 11, P, 1, 0.5), { tone: "hi" }));
  poner(S(k.cylinder(px + 16, py, 2.4, BANCO_Z + 10, 2.4, P, 14), { tone: "mid" }));
  poner(L(k.segment([px + 18, py, BANCO_Z + 11], [px + 27, py, BANCO_Z + 11], P), { tone: "lo" }));
  poner(D([at([px + 27, py, BANCO_Z + 11])], { size: 0.7 }));
  poner(...tornillos(cuadro(px, py, 20, 16, 1), 3.5, BANCO_Z + 6, 1.6));

  // Panel perforado detrás, con sus ganchos y las herramientas colgadas.
  const panel = { x: b.x + 8, y: b.y + 1.5, w: b.w - 16, d: 2.6, r: 0.8 };
  poner(S(k.slabOf(panel, BANCO_Z, 58, P, 1, 0.6), { tone: "lo" }));
  poner(L(k.planOutline(k.insetPlan(panel, 2), BANCO_Z + 58, P), { tone: "faint" }));
  const ganchos = [];
  for (let i = 0; i < 11; i++) for (let j = 0; j < 4; j++) {
    ganchos.push(at([panel.x + 7 + i * 10, panel.y, BANCO_Z + 12 + j * 12]));
  }
  poner(D(ganchos, { size: 0.38 }));
  // Herramientas: cada una nace de su gancho y termina en su punta.
  for (const [i, fila, largo, ancho] of [[1, 3, 17, 1], [3, 3, 13, 1], [5, 2, 20, 1], [7, 3, 11, 1], [9, 2, 15, 1]]) {
    const x = panel.x + 7 + i * 10;
    const z = BANCO_Z + 12 + fila * 12;
    poner(L(k.segment([x, panel.y, z], [x, panel.y, z - largo], P), { tone: "mid" }));
    poner(D([at([x, panel.y, z - largo])], { size: 0.52 }));
    // Mango: un trazo corto más grueso en el extremo de arriba.
    poner(L(k.segment([x, panel.y, z], [x, panel.y, z - largo * 0.3], P), { tone: "hi" }));
    poner(D([at([x, panel.y, z - largo * 0.3])], { size: 0.45 }));
  }
}

// ── 6. Tambor de aceite ────────────────────────────────────────────────────
function tambor() {
  const { x, y, r, alto } = TAMBOR;
  poner(halo(cuadro(x, y, r * 2, r * 2, r), 0, alto));
  poner(S(k.cylinder(x, y, r, 0, alto, P, 32, 1.2), { tone: "mid" }));
  // Nervios de rodadura: dos pares de anillos, como los del tambor real.
  for (const z of [16, 19, 37, 40]) poner(L(k.ring(x, y, r, z, P, 32), { tone: "lo" }));
  // Banda de etiqueta entre los nervios.
  poner(L(k.ring(x, y, r, 26, P, 32), { tone: "faint" }));
  poner(L(k.ring(x, y, r, 31, P, 32), { tone: "faint" }));
  // Boca: corona, dos tapones y el reborde superior.
  poner(L(k.ring(x, y, r - 2.5, alto, P, 28), { tone: "lo" }));
  poner(L(k.ring(x, y, r - 7, alto, P, 24), { tone: "faint" }));
  for (const [dx, dy, rr] of [[7, -6, 3], [-7, 5, 2]]) {
    poner(L(k.ring(x + dx, y + dy, rr, alto, P, 12), { tone: "lo" }));
    poner(D([at([x + dx, y + dy, alto])], { size: 0.6 }));
  }
}

// ── 7. Pila de neumáticos ──────────────────────────────────────────────────
// Llena la esquina del fondo, que antes quedaba pelada, y es inconfundible.
function neumaticos() {
  const { x, y, r } = NEUMATICOS;
  poner(halo(cuadro(x, y, r * 2, r * 2, r), 0, 42));
  for (let i = 0; i < 3; i++) {
    const z = i * 14;
    const dx = (i % 2 ? 1.6 : -1.2);          // la pila no está perfecta
    poner(S(k.cylinder(x + dx, y, r, z, 14, P, 30, 1.4), { tone: "lo" }));
    poner(L(k.ring(x + dx, y, r, z + 2, P, 30) + k.ring(x + dx, y, r, z + 12, P, 30), { tone: "faint" }));
    poner(L(k.knurl(x + dx, y, r, z + 2, z + 12, 20, P, 0.7), { tone: "faint" }));
    poner(L(k.ring(x + dx, y, r - 8, z + 14, P, 22), { tone: "faint" }));
  }
  poner(L(k.ring(x + 1.6, y, r - 8, 42, P, 22), { tone: "lo" }));
}

// ── 8. Caballetes de apoyo ─────────────────────────────────────────────────
// Caballete de apoyo. Las patas son SÓLIDOS y no trazos: hechas con líneas
// quedaban cuatro rayas sueltas que parecían una antena rota, no una pieza.
function caballete(x, y) {
  const alto = 34;
  poner(halo(cuadro(x, y, 26, 26, 3), 0, alto));
  // Base: cuatro patas en abanico, cada una un perfil que nace del pie y
  // termina contra la columna.
  const pies = porFondo([[-11, -9], [11, -9], [-11, 9], [11, 9]].map(([dx, dy]) => [x + dx, y + dy]));
  for (const [px, py] of pies) {
    poner(S(k.slabOf(cuadro(px, py, 7, 7, 1), 0, 2.4, P, 1, 0.4), { tone: "lo" }));
    // La pata: un perfil inclinado, resuelto como dos tramos cortos apilados
    // para que el escalonado lea como el doblez de la chapa.
    poner(S(k.slabOf(cuadro((px * 2 + x) / 3, (py * 2 + y) / 3, 5, 5, 1), 2.4, alto * 0.45, P, 1, 0.3), { tone: "lo" }));
    poner(S(k.slabOf(cuadro((px + x * 2) / 3, (py + y * 2) / 3, 5, 5, 1), alto * 0.45, alto * 0.4, P, 1, 0.3), { tone: "lo" }));
  }
  // Columna dentada y la horquilla donde apoya el chasis.
  poner(S(k.slabOf(cuadro(x, y, 8, 8, 1), alto * 0.5, alto * 0.5, P, 1, 0.5), { tone: "mid" }));
  for (let i = 0; i < 4; i++) {
    poner(L(k.segment([x - 4, y - 4.9, alto * 0.58 + i * 4.4], [x - 4, y + 4.9, alto * 0.58 + i * 4.4], P), { tone: "faint" }));
  }
  poner(S(k.slabOf(cuadro(x, y, 16, 7, 1), alto, 4, P, 1, 0.5), { tone: "mid" }));
  poner(L(k.segment([x - 6, y, alto + 4], [x + 6, y, alto + 4], P), { tone: "lo" }));
  poner(D([at([x - 6, y, alto + 4]), at([x + 6, y, alto + 4])], { size: 0.5 }));
  // Pasador de seguridad, atravesado en la columna.
  poner(L(k.segment([x + 4, y - 7, alto - 6], [x + 4, y + 7, alto - 6], P), { tone: "lo" }));
  poner(D([at([x + 4, y - 7, alto - 6]), at([x + 4, y + 7, alto - 6])], { size: 0.5 }));
}

// ── Orden de pintado: de atrás hacia adelante ──────────────────────────────
piso();
neumaticos();
carroHerramientas();
poner(...poste(-POSTE_Y, false));    // poste del fondo
travesano();
tambor();
vehiculo();                          // el auto, entre los dos postes
for (const [x, y] of porFondo(CABALLETES)) caballete(x, y);
banco();
poner(...poste(POSTE_Y, true));      // poste de adelante, encima de todo

// El navy del producto sobre la escala neutra del kit. No se cambia la
// jerarquía de tonos, solo se la tiñe: es lo mismo que hace el sistema con el
// color del taller en la interfaz. Los cuatro `shade` tienen que quedar bien
// separados entre sí — si se juntan, cada sólido pierde volumen y el dibujo
// entero se lee como siluetas planas.
const TINTE = `
.iso[data-theme="dark"]{
  --anatomy-paper:#111b27;--anatomy-face:#18242f;--anatomy-top:#1e2c3a;
  --anatomy-shade-0:#0c1420;--anatomy-shade-1:#101a26;--anatomy-shade-2:#14202d;--anatomy-shade-3:#192735;
  --anatomy-lit-top:#35598a;--anatomy-lit-shade:#213a56;
  --anatomy-hi:#c3d4e6;--anatomy-mid:#6a85a3;--anatomy-lo:#3e5368;--anatomy-faint:#2a3a4a;
  --anatomy-lit:#f2f7ff;--anatomy-halo:#04070b;--anatomy-halo-opacity:.8;--anatomy-dot:#dbe7f5;
}`;

const svg = k.figureSvg({
  width: ANCHO,
  height: ALTO,
  label: "Bahía de taller: un vehículo levantado sobre un elevador de dos postes, con carro de herramientas, banco de trabajo y tambor de aceite",
  body: piezas,
  standalone: "dark",
});

// Fondo propio, del mismo negro que el panel de acceso.
const conFondo = svg
  .replace("</style>", `${TINTE}</style>`)
  .replace(/(<svg[^>]*>)/, `$1<rect width="100%" height="100%" fill="${TINTA}"/>`);

writeFileSync(SALIDA, conFondo, "utf8");
console.log(`taller-iso.svg escrito (${piezas.length} piezas, ${(conFondo.length / 1024).toFixed(0)} KB)`);
