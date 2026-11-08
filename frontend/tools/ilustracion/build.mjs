// Dibuja la bahía de taller que va de fondo en las pantallas de acceso de Motiq.
//
// Por qué un dibujo y no una fotografía: la que había vino con el código de MS
// Motos y era SU taller. En un producto que le alquila el sistema a muchos
// talleres, una foto de uno solo es la marca de un cliente puesta de fondo para
// todos. Un dibujo del oficio no es de nadie en particular y es de todos.
//
// El objeto es una bahía con elevador de dos postes: la máquina que cualquiera
// reconoce al entrar a un taller, y que sirve igual para un auto o una moto, que
// es lo que el SaaS tiene que representar.
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

const HERE = dirname(fileURLToPath(import.meta.url));
const SALIDA = join(HERE, "../../src/assets/portal/taller-iso.svg");

const ANCHO = 1120;
const ALTO = 820;

// ── Mundo ──────────────────────────────────────────────────────────────────
// Una unidad ≈ un píxel de la cosa real. x e y en el piso, z hacia arriba.
const PISO = { x: -210, y: -150, w: 420, d: 300, r: 12 };

// Elevador de dos postes: las columnas van una a cada lado del vehículo.
const POSTE_X = -34;
const POSTE_Y = 86;                 // ± a cada lado
const COLUMNA = { w: 26, d: 26, r: 2 };
const COLUMNA_ALTO = 186;
const BASE = { w: 52, d: 52, r: 3 };
const BASE_ALTO = 5;
const CARRO_Z = 58;                 // altura a la que quedó el elevador
const CARRO_ALTO = 30;
const BRAZO_Z = CARRO_Z + 9;
const TACO_Z = BRAZO_Z + 5;

// El vehículo, que es la única pieza encendida del dibujo.
//
// Se arma en tres volúmenes escalonados (capó, cabina, baúl) en vez de una caja:
// una caja redondeada no se lee como un auto, y el dibujo entero depende de que
// esta pieza se reconozca de inmediato. La carrocería es más angosta que la
// distancia entre postes para que los brazos del elevador se vean por debajo —
// si la tapa, se pierde el mecanismo, que es lo que cuenta la escena.
const VEH_Z = TACO_Z + 6;
const CUERPO = { x: -118, y: -30, w: 182, d: 60, r: 9 };
const CUERPO_ALTO = 20;
const CAPO = { x: -112, y: -27, w: 56, d: 54, r: 7 };
const CAPO_ALTO = 11;
const CABINA = { x: -58, y: -27, w: 74, d: 54, r: 11 };
const CABINA_ALTO = 30;
const BAUL = { x: 16, y: -27, w: 44, d: 54, r: 7 };
const BAUL_ALTO = 14;
const RUEDA_R = 15;
const RUEDA_ANCHO = 11;
const RUEDAS = [[-82, -36], [-82, 36], [26, -36], [26, 36]];

const CARRO_HERR = { x: 104, y: -126, w: 62, d: 46, r: 3 };
const CARRO_HERR_ALTO = 84;
const BANCO = { x: 92, y: 88, w: 112, d: 38, r: 2 };
const BANCO_Z = 52;

const P = k.fitProjection(
  [
    ...k.boxCorners(PISO, -8, 0),
    [POSTE_X, -POSTE_Y, COLUMNA_ALTO + 16],
    [POSTE_X, POSTE_Y, COLUMNA_ALTO + 16],
    [CUERPO.x + CUERPO.w, 0, VEH_Z + CUERPO_ALTO + CABINA_ALTO],
    [CARRO_HERR.x + CARRO_HERR.w, CARRO_HERR.y, CARRO_HERR_ALTO],
  ],
  ANCHO,
  ALTO,
  { pad: 26, azimuth: 48, elevation: 21 },
);

const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (pts, style) => k.dotsSvg(pts, style);
const mover = (plan, dx, dy) => ({ ...plan, x: plan.x + dx, y: plan.y + dy });
const centrar = (cx, cy, plan) => ({ ...plan, x: cx - plan.w / 2, y: cy - plan.d / 2 });
// Las piezas que se repiten se pintan de atrás hacia adelante.
const porFondo = (pts) => [...pts].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));

const piezas = [];
const poner = (...svg) => piezas.push(...svg);

// ── 1. El piso ─────────────────────────────────────────────────────────────
function piso() {
  poner(`<path class="iso-halo" d="${k.haloOf(PISO, -8, 8, P)}"/>`);
  poner(S(k.slabOf(PISO, -8, 8, P, 10, 1.4), { tone: "lo" }));
  // Junta de dilatación: dos líneas rectas de borde a borde, como las del piso real.
  poner(L(k.planOutline(k.insetPlan(PISO, 16), 0, P), { tone: "faint" }));
  poner(L(k.segment([PISO.x + 16, -4, 0], [PISO.x + PISO.w - 16, -4, 0], P), { tone: "faint" }));

  // Regla grabada en el borde, con marca mayor cada cinco.
  const regla = { x: PISO.x + 22, y: PISO.y + PISO.d - 15, w: PISO.w - 44, d: 8, r: 1 };
  poner(S(k.slabOf(regla, 0, 0.7, P, 3), { tone: "lo", crease: "none" }));
  const t = k.topTicks(regla.x + 5, regla.x + regla.w - 5, 7, 5, regla.y + 1, 0.7, [2.4, 4.4], P);
  poner(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }));

  // Rejilla del desagüe: ranuras cerradas, nunca líneas sueltas.
  const rej = { x: 96, y: 4, w: 54, d: 30, r: 2 };
  poner(S(k.slabOf(rej, -1.2, 1.2, P, 3), { tone: "faint" }));
  for (let i = 0; i < 6; i++) {
    const ranura = { x: rej.x + 5 + i * 7.4, y: rej.y + 4, w: 3.4, d: rej.d - 8, r: 1.2 };
    poner(L(k.planOutline(ranura, 1.2, P), { tone: "lo" }));
  }

  // Anclajes del piso.
  const anclas = k.corners(k.insetPlan(PISO, 26), 0);
  poner(L(anclas.map(([x, y]) => k.ring(x, y, 3, 0, P, 16)).join(""), { tone: "lo" }));
  poner(D(anclas.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
}

// ── 2. Un poste del elevador ───────────────────────────────────────────────
// Se dibuja entero (base, columna, escalera de trabas, carro y brazos) para
// poder pintar el de atrás antes del vehículo y el de adelante después.
function poste(ladoY, conMando) {
  const out = [];
  const base = centrar(POSTE_X, ladoY, BASE);
  const col = centrar(POSTE_X, ladoY, COLUMNA);

  out.push(`<path class="iso-halo" d="${k.haloOf(base, 0, BASE_ALTO, P)}"/>`);
  out.push(S(k.slabOf(base, 0, BASE_ALTO, P, 3, 0.8), { tone: "lo" }));
  // Pernos de anclaje de la base.
  const pernos = k.corners(k.insetPlan(base, 7), 0);
  out.push(L(pernos.map(([x, y]) => k.ring(x, y, 2.4, BASE_ALTO, P, 14)).join(""), { tone: "lo" }));
  out.push(D(pernos.map(([x, y]) => at([x, y, BASE_ALTO])), { size: 0.5 }));

  // La columna, con su canal frontal y la escalera de trabas de seguridad.
  out.push(S(k.slabOf(col, BASE_ALTO, COLUMNA_ALTO - BASE_ALTO, P, 2, 0.9), { tone: "mid" }));
  out.push(L(k.segment([POSTE_X - COLUMNA.w / 2 + 4, ladoY - COLUMNA.d / 2, BASE_ALTO],
                       [POSTE_X - COLUMNA.w / 2 + 4, ladoY - COLUMNA.d / 2, COLUMNA_ALTO], P), { tone: "faint" }));
  for (let z = BASE_ALTO + 14; z < COLUMNA_ALTO - 10; z += 11) {
    out.push(L(k.segment([POSTE_X - COLUMNA.w / 2, ladoY - 5, z], [POSTE_X - COLUMNA.w / 2, ladoY + 5, z], P), { tone: "lo" }));
  }
  // Tapa superior con sus cuatro tornillos.
  const tapa = centrar(POSTE_X, ladoY, { w: COLUMNA.w + 7, d: COLUMNA.d + 7, r: 2 });
  out.push(S(k.slabOf(tapa, COLUMNA_ALTO, 4, P, 2, 0.6), { tone: "lo" }));
  const tt = k.corners(k.insetPlan(tapa, 5), 0);
  out.push(D(tt.map(([x, y]) => at([x, y, COLUMNA_ALTO + 4])), { size: 0.45 }));

  // El carro que sube, abrazando la columna.
  const carro = centrar(POSTE_X, ladoY, { w: COLUMNA.w + 13, d: COLUMNA.d + 13, r: 2 });
  out.push(S(k.slabOf(carro, CARRO_Z, CARRO_ALTO, P, 2, 0.8), { tone: "hi" }));
  out.push(L(k.planOutline(k.insetPlan(carro, 4), CARRO_Z + CARRO_ALTO, P), { tone: "lo" }));
  // Rodillos del carro, uno arriba y otro abajo.
  for (const z of [CARRO_Z + 5, CARRO_Z + CARRO_ALTO - 5]) {
    out.push(S(k.cylinder(POSTE_X + COLUMNA.w / 2 + 5, ladoY, 3.4, z - 2.6, 5.2, P, 18), { tone: "mid" }));
  }

  // Los dos brazos que van por debajo del vehículo, con su taco de goma.
  const haciaDentro = ladoY > 0 ? -1 : 1;
  for (const dx of [-54, 40]) {
    const largo = 52;
    const brazo = {
      x: POSTE_X + dx - 7, y: ladoY + haciaDentro * 10 - (haciaDentro > 0 ? 0 : largo),
      w: 15, d: largo, r: 3,
    };
    out.push(S(k.slabOf(brazo, BRAZO_Z, 9, P, 3, 0.7), { tone: "mid" }));
    // Línea del tramo telescópico.
    out.push(L(k.planOutline(k.insetPlan(brazo, 3.4), BRAZO_Z + 9, P), { tone: "faint" }));
    const tx = POSTE_X + dx;
    const ty = ladoY + haciaDentro * (10 + largo - 9);
    out.push(S(k.cylinder(tx, ty, 9, TACO_Z, 5, P, 22), { tone: "lo" }));
    out.push(S(k.cylinder(tx, ty, 7, TACO_Z + 5, 3, P, 22), { tone: "hi" }));
    out.push(L(k.ring(tx, ty, 4.4, TACO_Z + 8, P, 20), { tone: "lo" }));
  }

  // El mando va en un solo poste, como en los de verdad.
  if (conMando) {
    const caja = centrar(POSTE_X + 30, ladoY, { w: 26, d: 20, r: 2 });
    out.push(S(k.slabOf(caja, 96, 34, P, 2, 0.7), { tone: "hi" }));
    out.push(L(k.planOutline(k.insetPlan(caja, 3.6), 130, P), { tone: "lo" }));
    const botones = [[caja.x + 8, caja.y + 7], [caja.x + 8, caja.y + 13], [caja.x + 17, caja.y + 10]];
    out.push(D(botones.map(([x, y]) => at([x, y, 130])), { size: 0.75 }));
    // Manguera del mando bajando por la columna hasta la base.
    out.push(L(k.segment([caja.x + 2, ladoY, 96], [POSTE_X + COLUMNA.w / 2, ladoY, 70], P), { tone: "lo" }));
    out.push(L(k.segment([POSTE_X + COLUMNA.w / 2, ladoY, 70], [POSTE_X + COLUMNA.w / 2, ladoY, BASE_ALTO + 3], P), { tone: "lo" }));
  }
  return out;
}

// Travesaño de arriba, que une las dos columnas.
function travesano() {
  const t = { x: POSTE_X - 7, y: -POSTE_Y, w: 14, d: POSTE_Y * 2, r: 2 };
  poner(S(k.slabOf(t, COLUMNA_ALTO - 12, 12, P, 2, 0.7), { tone: "mid" }));
  poner(L(k.segment([POSTE_X, -POSTE_Y + 8, COLUMNA_ALTO], [POSTE_X, POSTE_Y - 8, COLUMNA_ALTO], P), { tone: "faint" }));
}

// ── 3. El vehículo, la pieza encendida ─────────────────────────────────────
function vehiculo() {
  const techo = VEH_Z + CUERPO_ALTO + CABINA_ALTO;

  // Las ruedas sobresalen de la carrocería: es lo que hace que se lea un auto y
  // no un bloque. Cuelgan, porque el vehículo está levantado.
  for (const [x, y] of porFondo(RUEDAS)) {
    const fuera = y > 0 ? 1 : -1;
    const borde = y + fuera * (RUEDA_ANCHO / 2 + 2);
    poner(S(k.cylinder(x, borde, RUEDA_R, VEH_Z - 13, RUEDA_ANCHO, P, 26), { tone: "mid" }));
    poner(L(k.ring(x, borde, RUEDA_R - 5.5, VEH_Z - 13 + RUEDA_ANCHO, P, 22), { tone: "hi" }));
    poner(D([at([x, borde, VEH_Z - 13 + RUEDA_ANCHO])], { size: 0.5 }));
  }

  // Carrocería: una sola pieza baja que une todo, y encima los tres volúmenes.
  poner(S(k.slabOf(CUERPO, VEH_Z, CUERPO_ALTO, P, 10, 1.8), { tone: "hi", lit: true, halo: true }));
  // Zócalo y pasarruedas, de borde a borde del costado.
  poner(L(k.planOutline(k.insetPlan(CUERPO, 4), VEH_Z + CUERPO_ALTO, P), { tone: "lo" }));
  for (const [x] of [[-82], [26]]) {
    poner(L(k.ring(x, CUERPO.y + CUERPO.d, RUEDA_R + 2, VEH_Z + 3, P, 20), { tone: "faint" }));
  }

  poner(S(k.slabOf(CAPO, VEH_Z + CUERPO_ALTO, CAPO_ALTO, P, 8, 1.4), { tone: "hi", lit: true }));
  poner(S(k.slabOf(BAUL, VEH_Z + CUERPO_ALTO, BAUL_ALTO, P, 8, 1.4), { tone: "hi", lit: true }));
  poner(S(k.slabOf(CABINA, VEH_Z + CUERPO_ALTO, CABINA_ALTO, P, 12, 2.2), { tone: "hi", lit: true }));

  // Vidrios: el parabrisas y la luneta cruzan el techo de lado a lado, y las
  // ventanillas bajan por el costado hasta la línea de la puerta.
  poner(L(k.planOutline(k.insetPlan(CABINA, 7), techo, P), { tone: "faint" }));
  for (const dx of [10, CABINA.w - 10]) {
    poner(L(k.segment([CABINA.x + dx, CABINA.y + 3, techo], [CABINA.x + dx, CABINA.y + CABINA.d - 3, techo], P), { tone: "lo" }));
  }
  // Montante central de la puerta, de techo a carrocería.
  poner(L(k.segment([CABINA.x + CABINA.w / 2, CABINA.y + CABINA.d, techo],
                    [CABINA.x + CABINA.w / 2, CABINA.y + CABINA.d, VEH_Z + CUERPO_ALTO], P), { tone: "lo" }));
  // Faros y ópticas traseras, que dan el frente y la cola.
  poner(D([at([CAPO.x + 3, CAPO.y + 12, VEH_Z + CUERPO_ALTO + CAPO_ALTO - 3]),
           at([CAPO.x + 3, CAPO.y + CAPO.d - 12, VEH_Z + CUERPO_ALTO + CAPO_ALTO - 3])], { size: 0.9 }));
  poner(D([at([BAUL.x + BAUL.w - 3, BAUL.y + 11, VEH_Z + CUERPO_ALTO + BAUL_ALTO - 3]),
           at([BAUL.x + BAUL.w - 3, BAUL.y + BAUL.d - 11, VEH_Z + CUERPO_ALTO + BAUL_ALTO - 3])], { size: 0.8 }));
}

// ── 4. Carro de herramientas ───────────────────────────────────────────────
function carroHerramientas() {
  const c = CARRO_HERR;
  poner(`<path class="iso-halo" d="${k.haloOf(c, 7, CARRO_HERR_ALTO, P)}"/>`);
  // Ruedas giratorias.
  for (const [x, y] of porFondo(k.corners(k.insetPlan(c, 8), 0))) {
    poner(S(k.cylinder(x, y, 4, 0, 7, P, 16), { tone: "lo" }));
  }
  poner(S(k.slabOf(c, 7, CARRO_HERR_ALTO - 7, P, 3, 1), { tone: "mid" }));
  // Los cajones, cada uno con su tirador de lado a lado.
  const alturas = [16, 13, 13, 11, 11];
  let z = 12;
  for (const alto of alturas) {
    const frente = { x: c.x + 3, y: c.y + c.d - 1.4, w: c.w - 6, d: 1.4, r: 0.6 };
    poner(S(k.slabOf(frente, z, alto - 3, P, 1), { tone: "hi", crease: "none" }));
    poner(L(k.segment([c.x + 14, c.y + c.d, z + alto - 8], [c.x + c.w - 14, c.y + c.d, z + alto - 8], P), { tone: "lo" }));
    z += alto;
  }
  // Tapa de trabajo, apenas volada.
  const tapa = { x: c.x - 2, y: c.y - 2, w: c.w + 4, d: c.d + 4, r: 3 };
  poner(S(k.slabOf(tapa, CARRO_HERR_ALTO, 3.4, P, 3, 0.7), { tone: "hi" }));
  poner(L(k.planOutline(k.insetPlan(tapa, 5), CARRO_HERR_ALTO + 3.4, P), { tone: "faint" }));
}

// ── 5. Banco de trabajo con prensa ─────────────────────────────────────────
function banco() {
  const b = BANCO;
  poner(`<path class="iso-halo" d="${k.haloOf(b, 0, BANCO_Z, P)}"/>`);
  for (const [x, y] of porFondo(k.corners(k.insetPlan(b, 6), 0))) {
    poner(S(k.cylinder(x, y, 3, 0, BANCO_Z - 6, P, 12), { tone: "lo" }));
  }
  // Estante bajo, entre las patas.
  const estante = k.insetPlan(b, 8);
  poner(S(k.slabOf(estante, 15, 2.2, P, 2), { tone: "lo" }));
  poner(S(k.slabOf(b, BANCO_Z - 6, 6, P, 2, 1), { tone: "mid" }));
  poner(L(k.planOutline(k.insetPlan(b, 4), BANCO_Z, P), { tone: "faint" }));
  // Prensa atornillada en la punta.
  const px = b.x + 14;
  const py = b.y + b.d / 2;
  poner(S(k.slabOf(centrar(px, py, { w: 18, d: 14, r: 1.5 }), BANCO_Z, 9, P, 2, 0.6), { tone: "hi" }));
  poner(S(k.slabOf(centrar(px + 11, py, { w: 5, d: 14, r: 1 }), BANCO_Z, 12, P, 1), { tone: "mid" }));
  poner(S(k.cylinder(px - 13, py, 2.2, BANCO_Z + 5, 2.2, P, 14), { tone: "mid" }));
  poner(L(k.segment([px - 15, py, BANCO_Z + 6], [px - 24, py, BANCO_Z + 6], P), { tone: "lo" }));
  poner(D([at([px - 24, py, BANCO_Z + 6])], { size: 0.7 }));

  // Panel de herramientas detrás, con sus ganchos.
  const panel = { x: b.x + 6, y: b.y + 1, w: b.w - 12, d: 2.4, r: 0.8 };
  poner(S(k.slabOf(panel, BANCO_Z, 54, P, 1, 0.5), { tone: "lo" }));
  const ganchos = [];
  for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) ganchos.push(at([panel.x + 8 + i * 10, panel.y, BANCO_Z + 14 + j * 13]));
  poner(D(ganchos, { size: 0.4 }));
  // Tres herramientas colgadas: cada una termina en su gancho.
  for (const [i, fila, largo] of [[1, 2, 16], [4, 2, 12], [6, 1, 18], [8, 2, 10]]) {
    const x = panel.x + 8 + i * 10;
    const z = BANCO_Z + 14 + fila * 13;
    poner(L(k.segment([x, panel.y, z], [x, panel.y, z - largo], P), { tone: "mid" }));
    poner(D([at([x, panel.y, z]), at([x, panel.y, z - largo])], { size: 0.55 }));
  }
}

// ── 6. Un tambor de aceite, para que la esquina no quede pelada ────────────
function tambor() {
  const cx = 168;
  const cy = -18;
  poner(`<path class="iso-halo" d="${k.haloOf(centrar(cx, cy, { w: 36, d: 36, r: 18 }), 0, 54, P)}"/>`);
  poner(S(k.cylinder(cx, cy, 18, 0, 54, P, 30), { tone: "mid" }));
  for (const z of [14, 27, 40]) poner(L(k.ring(cx, cy, 18, z, P, 30), { tone: "lo" }));
  poner(L(k.ring(cx, cy, 12, 54, P, 26), { tone: "faint" }));
  poner(D([at([cx + 7, cy - 7, 54])], { size: 0.6 }));
}

// ── Orden de pintado: de atrás hacia adelante ──────────────────────────────
piso();
poner(...poste(-POSTE_Y, false));   // poste del fondo
travesano();
carroHerramientas();
banco();
// Sin vehículo a propósito. Se probó con uno encima del elevador y no se leía:
// a esta cámara se ve sobre todo su tapa, las ruedas quedan debajo de la
// carrocería y el conjunto termina pareciendo cajas apiladas. Una pieza que no
// se reconoce no suma, tapa — y tapaba justo el mecanismo, que es lo que hace
// reconocible la escena. El elevador vacío con los brazos a la vista se entiende
// solo, y además le queda bien a una pantalla de entrada: la bahía esperando.
tambor();
poner(...poste(POSTE_Y, true));     // poste de adelante, encima de todo

// El navy del producto sobre la escala neutra del kit. No se cambia la
// jerarquía de tonos, solo se la tiñe: es lo mismo que hace el sistema con el
// color del taller en la interfaz.
const TINTE = `
.iso[data-theme="dark"]{
  --anatomy-paper:#101822;--anatomy-face:#16202c;--anatomy-top:#1a2634;
  --anatomy-shade-0:#0b1118;--anatomy-shade-1:#0e141d;--anatomy-shade-2:#111823;--anatomy-shade-3:#141d29;
  --anatomy-lit-top:#2b4663;--anatomy-lit-shade:#1b2a3c;
  --anatomy-hi:#b9cadd;--anatomy-mid:#5d7693;--anatomy-lo:#36485d;--anatomy-faint:#24323f;
  --anatomy-lit:#e9f1fb;--anatomy-halo:#05080c;--anatomy-halo-opacity:.85;--anatomy-dot:#d2dfee;
}`;

const svg = k.figureSvg({
  width: ANCHO,
  height: ALTO,
  label: "Bahía de taller: elevador de dos postes con un vehículo levantado, carro de herramientas y banco de trabajo",
  body: piezas,
  standalone: "dark",
});

writeFileSync(SALIDA, svg.replace("</style>", `${TINTE}</style>`), "utf8");
console.log(`taller-iso.svg escrito (${piezas.length} piezas, ${(svg.length / 1024).toFixed(0)} KB)`);
