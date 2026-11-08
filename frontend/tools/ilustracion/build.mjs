// La figura de las pantallas de acceso: un sedán levantado en un elevador de dos
// postes, con la rueda delantera desmontada y el freno a la vista. El titular dice
// "tu vehículo, en buenas manos", y esto es exactamente eso: un auto sostenido por
// cuatro tacos mientras alguien trabaja en él. El disco es el único acento encendido.
//
// Sirve para cualquier taller porque es el oficio y no el local de nadie.
//
//   node frontend/tools/ilustracion/build.mjs           escribe src/assets/portal/taller-iso.svg
//   node frontend/tools/ilustracion/build.mjs --audit   además prueba la geometría
//
// Escala real: 1 unidad = 2 cm. El auto mide 4,48 x 1,80 m, las columnas 3,20 m.
// Los archivos del kit están copiados al lado para poder regenerarlo sin instalar nada.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "./iso-kit.mjs";
import * as G from "./lathe.mjs";
import * as A from "./audit.mjs";
import { tubePieces, tubeSvg } from "./tube.mjs";
import { malla, recortar, curva } from "./malla.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SALIDA = join(HERE, "../../src/assets/portal/taller-iso.svg");
const ANCHO = 960;
const ALTO = 600;

// ── Medidas ────────────────────────────────────────────────────────────────
const PISO = { x: -176, y: -112, w: 336, d: 236, r: 10 };
const PISO_ALTO = 9;
const PATA_ALTO = 5;

const SUBIDA = 56;                       // cuánto levantó el elevador: 1,12 m
const SOLERA = 9;                        // altura del piso del auto sobre sus ruedas
const Z_TACO = SUBIDA + SOLERA;          // la cara de arriba de los tacos toca el auto

const POSTE_X = 6;
const POSTE_Y = 92;
const COL_W = 17;
const COL_D = 15;
const COL_ALTO = 160;
const CARRO_Z = [44, 88];
const BRAZO_Z = [Z_TACO - 14, Z_TACO - 8];
const TACOS_X = [44, -36];
const TACO_Y = 36;

const EJE_D = 70;
const EJE_T = -64;
const ARCO_R = 19;
const ARCO_Z = 15;
const RUEDA_R = 16;
const RUEDA_ANCHO = 14;
const RUEDA_Z = 13;                      // colgada: la suspensión estira al levantarla
const COCHE_W = 45;
const HAB_W = 38;

const P = k.fitProjection(
  [...k.boxCorners(PISO, -PISO_ALTO - PATA_ALTO, 0), [POSTE_X, -POSTE_Y, COL_ALTO + 16], [POSTE_X, POSTE_Y, COL_ALTO + 16]],
  ANCHO,
  ALTO,
  { pad: 16, azimuth: 62, elevation: 26 },
);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (pts, style) => k.dotsSvg(pts, style);
const trazo = (pts, cerrado = false) => k.pathOf(pts.map(at), cerrado);
const relleno = (clase, pts) => `<path class="${clase}" d="${trazo(pts, true)}"/>`;
const rad = (g) => (g * Math.PI) / 180;
const porFondo = (pts) => [...pts].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));

const R = A.recorder(P);
const put = (name, ref, svg, shapes = [], { bias = 0, ...rest } = {}) => R.put({ name, at: ref, bias, svg, shapes, piece: "taller", ...rest });

function caja(name, [x0, y0, z0], [x1, y1, z1], style = {}, { r = 0.5, steps = 2, bevel = 0.4, inner = "", extra = "", owner, bias = 0 } = {}) {
  const plan = { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r };
  const shape = R.solid(A.slab(plan, z0, z1 - z0, { name, owner }, steps));
  put(name, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], S(k.slabOf(plan, z0, z1 - z0, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias });
  return plan;
}
function torneado(name, F, perfil, style = {}, { inner = "", extra = "", owner, bias = 0, bevel = 0 } = {}) {
  const shape = R.solid(A.solid(F, perfil, { name, owner }));
  const medio = (perfil[0][0] + perfil[perfil.length - 1][0]) / 2;
  put(name, G.add3(F.o, G.mul3(F.a, medio)), S(G.solidOf(perfil, F, P, { bevel }), { tone: "mid", ...style, inner }) + extra, [shape], { bias });
}
const eje = (o, a) => G.frameAlong(o, a);
const ejeZ = (x, y, z = 0) => G.frameOf([x, y, z], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
const ejeY = (x, y, z) => G.frameOf([x, y, z], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
const ejeX = (x, y, z) => G.frameOf([x, y, z], [1, 0, 0], [0, 1, 0], [0, 0, 1]);

// Viga en cualquier ángulo de planta, de `a` a `b`.
function viga(name, a, b, ancho, z0, z1, style = {}, { owner, bias = 0, inner = "" } = {}) {
  const d = G.unit3([b[0] - a[0], b[1] - a[1], 0]);
  const n = [(-d[1] * ancho) / 2, (d[0] * ancho) / 2];
  const ring = [[a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], [b[0] - n[0], b[1] - n[1]], [a[0] - n[0], a[1] - n[1]]];
  const shape = R.solid(A.extruded(ring, z0, z1 - z0, { name, owner }));
  put(name, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (z0 + z1) / 2], S(k.extrude(ring, z0, z1 - z0, P, { bevel: 0.4 }), { tone: "mid", ...style, inner }), [shape], { bias });
}

function tornillos(plan, inset, z, r = 1.6) {
  const pts = k.corners(k.insetPlan(plan, inset), 0);
  return Ln(pts.map(([x, y]) => k.ring(x, y, r, z, P, 12)).join(""), { tone: "lo" }) + Dots(pts.map(([x, y]) => at([x, y, z])), { size: 0.45 });
}

function manguera(name, puntos, r, { tone = "mid", curva: radio = 5, fin = [true, true], maxLength = 22, bias = 0.05, touch } = {}) {
  const ruta = G.fillet(puntos, Math.max(radio, r * 2.6), 10, { P, tube: r });
  const total = G.pathLength(ruta);
  const CASQ = Math.max(2, r * 2.6);
  const gaps = [...(fin[0] ? [[0, CASQ]] : []), ...(fin[1] ? [[total - CASQ, total]] : [])];
  R.route(name, ruta, r, { gaps, limp: true, touch, rims: fin.map((f) => (f ? r * 1.8 : r)), piece: "taller" });
  tubePieces(ruta, r, P, { maxLength, spacing: Math.max(0.6, Math.min(1.6, r)), gaps }).forEach((pieza, i) =>
    put(`${name}:${i}`, pieza.mid, tubeSvg(pieza, { tone }), [A.tube(pieza.points, pieza.radii)], { bias, route: name, chunk: i }),
  );
  [0, 1].forEach((i) => {
    if (!fin[i]) return;
    const punta = i ? ruta[ruta.length - 1] : ruta[0];
    const t = G.tangentAlong(ruta, i ? total : 0);
    const F = eje(punta, t);
    const [s0, s1] = i ? [-CASQ, 0] : [0, CASQ];
    const shape = R.solid(A.disc(F, s0, s1, r * 1.8, { name: `${name}.casq${i}`, owner: name }));
    put(`${name}.casq${i}`, G.add3(punta, G.mul3(t, (s0 + s1) / 2)), S(G.disc(s0, s1, r * 1.8, F, P, { steps: 20, bevel: 0.2 }), { tone: "mid" }), [shape], { bias: bias + 0.1 });
  });
}

// ── Piso ───────────────────────────────────────────────────────────────────
const fondo = [];
function piso() {
  fondo.push(`<path class="iso-halo" d="${k.haloOf(PISO, -PISO_ALTO - PATA_ALTO, PISO_ALTO, P)}"/>`);
  for (const [x, y] of porFondo(k.corners(PISO, 24))) {
    fondo.push(S(k.cylinder(x, y, 8, -PISO_ALTO - PATA_ALTO, 1.8, P, 28), { tone: "lo" }));
    fondo.push(S(k.cylinder(x, y, 6, -PISO_ALTO - PATA_ALTO + 1.8, PATA_ALTO - 1.8, P, 28), { tone: "mid" }));
  }
  fondo.push(S(k.slabOf(PISO, -PISO_ALTO, PISO_ALTO, P, 8, 1.6), { tone: "lo", inner: Ln(k.sideSeam(PISO, -4, P, 8), { tone: "faint" }) }));
  R.solid(A.slab(PISO, -PISO_ALTO, PISO_ALTO, { name: "stand.piso", ground: true }, 8));
  fondo.push(Ln(k.planOutline(k.insetPlan(PISO, 5), 0, P), { tone: "lo" }));
  const esquinas = k.corners(PISO, 11);
  fondo.push(Ln(esquinas.map(([x, y]) => k.ring(x, y, 2.4, 0, P, 16)).join(""), { tone: "lo" }), Dots(esquinas.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));

  // Juntas de la losa: de ranura a ranura, sin terminar en el medio.
  const dentro = k.insetPlan(PISO, 5);
  for (const x of [-112, 124]) fondo.push(Ln(k.segment([x, dentro.y, 0], [x, dentro.y + dentro.d, 0], P), { tone: "faint" }));
  fondo.push(Ln(k.segment([dentro.x, 8, 0], [dentro.x + dentro.w, 8, 0], P), { tone: "faint" }));

  // La bahía demarcada, una línea doble cerrada alrededor del elevador.
  const bahia = { x: -112, y: -104, w: 236, d: 208, r: 2 };
  fondo.push(Ln(k.planOutline(bahia, 0, P, 3), { tone: "lo" }), Ln(k.planOutline(k.insetPlan(bahia, 2.2), 0, P, 3), { tone: "faint" }));

  // Canaleta de desagüe, con ranuras cerradas.
  const can = { x: -70, y: 62, w: 118, d: 11, r: 1 };
  fondo.push(S(k.slabOf(can, 0, 0.7, P, 2), { tone: "lo", crease: "none" }));
  for (let i = 0; i < 14; i++) fondo.push(Ln(k.planOutline({ x: can.x + 4 + i * 8, y: can.y + 2.5, w: 5, d: 6, r: 0.8 }, 0.7, P, 2), { tone: "faint" }));

  // Regla sobre el borde cercano y la chapa de identificación.
  const regla = { x: PISO.x + 18, y: PISO.y + PISO.d - 14, w: PISO.w - 36, d: 7, r: 1 };
  fondo.push(S(k.slabOf(regla, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const t = k.topTicks(regla.x + 4, regla.x + regla.w - 4, 5, 5, regla.y, 0.6, [2, 3.8], P);
  fondo.push(Ln(t.minor, { tone: "lo" }), Ln(t.major, { tone: "mid" }));
  const chapa = { x: PISO.x + PISO.w - 56, y: PISO.y + 16, w: 38, d: 17, r: 1.2 };
  fondo.push(S(k.slabOf(chapa, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
  fondo.push(Ln(k.planOutline(k.insetPlan(chapa, 1.5), 0.8, P, 3), { tone: "faint" }));
  fondo.push(Ln([26, 18, 22].map((w, i) => k.lineOnTop([chapa.x + 4.5, chapa.y + 4.5 + i * 4], [chapa.x + 4.5 + w, chapa.y + 4.5 + i * 4], 0.8, P)).join(""), { tone: "lo", free: true }));
}

// ── Elevador ───────────────────────────────────────────────────────────────
// Sección real de 34 x 30 cm. Con columnas más gruesas se lee un pilar de edificio.
const costuraCol = (plan, ...zs) => zs.map((z) => Ln(k.sideSeam(plan, z, P, 2), { tone: "faint" })).join("");

function poste(nombre, y, conGrupo) {
  const hacia = y > 0 ? -1 : 1;                // hacia el auto
  const col = { x: POSTE_X - COL_W / 2, y: y - COL_D / 2, w: COL_W, d: COL_D, r: 1 };
  const base = { x: POSTE_X - 17, y: y - 15, w: 34, d: 30, r: 1.5 };
  fondo.push(`<path class="iso-halo" d="${k.haloOf(base, 0, 2.5, P)}"/>`);
  caja(`${nombre}.base`, [base.x, base.y, 0], [base.x + base.w, base.y + base.d, 2.5], { tone: "lo" }, { r: 1.5, steps: 3, bevel: 0.6, extra: tornillos(base, 4.5, 2.5, 2) });

  // Cartelas de chapa que atan la columna a la base.
  for (const s of [-1, 1]) {
    const F = G.frameOf([POSTE_X + s * (COL_W / 2), y - 1, 2.5], [0, 1, 0], [s, 0, 0], [0, 0, 1]);
    const poli = [[0, 0], [8, 0], [0, 15]];
    const shape = R.solid(A.prism(F, poli, 0, 2, { name: `${nombre}.cartela${s}`, owner: nombre }));
    put(`${nombre}.cartela${s}`, [POSTE_X + s * (COL_W / 2 + 3), y, 7], S(G.prismOf(F, poli, 0, 2, P), { tone: "lo" }), [shape]);
  }

  // Columna en dos tramos, por debajo y por encima del carro que la abraza.
  const carrilX = POSTE_X + COL_W / 2;
  const ventanas = (z0, z1) => {
    let d = "";
    for (let z = z0; z < z1; z += 9) d += trazo([[carrilX, y - 3.6, z], [carrilX, y + 3.6, z], [carrilX, y + 3.6, z + 3.2], [carrilX, y - 3.6, z + 3.2]], true);
    return Ln(d, { tone: "lo" });
  };
  const tornCol = (z0, z1) => {
    const pts = [];
    for (let z = z0; z < z1; z += 18) pts.push(at([POSTE_X - COL_W / 2 + 3, y + COL_D / 2, z]), at([POSTE_X + COL_W / 2 - 3, y + COL_D / 2, z]));
    return Dots(pts, { size: 0.42 });
  };
  caja(`${nombre}.columna.baja`, [col.x, col.y, 2.5], [col.x + col.w, col.y + col.d, CARRO_Z[0]], { tone: "mid" }, { r: 1, bevel: 0.5, inner: costuraCol(col, 14), extra: ventanas(18, CARRO_Z[0] - 3) + tornCol(8, CARRO_Z[0] - 2) });
  caja(`${nombre}.columna.alta`, [col.x, col.y, CARRO_Z[1]], [col.x + col.w, col.y + col.d, COL_ALTO], { tone: "mid" }, { r: 1, bevel: 0.5, inner: costuraCol(col, 124, COL_ALTO - 8), extra: ventanas(CARRO_Z[1] + 4, COL_ALTO - 14) + tornCol(CARRO_Z[1] + 6, COL_ALTO - 10) });

  // Carro: abraza la columna y lleva rodillos, traba y los dos pivotes de brazo.
  const cx0 = POSTE_X - 12;
  const cx1 = POSTE_X + 12;
  const cy0 = y - 10;
  const cy1 = y + 10;
  const carro = { x: cx0, y: cy0, w: 24, d: 20, r: 1 };
  caja(`${nombre}.carro`, [cx0, cy0, CARRO_Z[0]], [cx1, cy1, CARRO_Z[1]], { tone: "hi", crease: "lo" }, {
    r: 1,
    bevel: 0.6,
    inner: costuraCol(carro, CARRO_Z[0] + 6, CARRO_Z[1] - 6),
    extra: Ln(k.planOutline(k.insetPlan(carro, 2.5), CARRO_Z[1], P, 2), { tone: "lo" }) + tornillos(carro, 3.2, CARRO_Z[1], 1),
  });
  for (const z of [CARRO_Z[0] + 11, CARRO_Z[1] - 11]) {
    const F = ejeX(cx1, y, z);
    torneado(`${nombre}.rodillo${z}`, F, [[0, 4.4], [1.4, 4.4], [1.4, 2.4], [2.2, 2.4]], { tone: "mid" }, { owner: nombre, extra: Dots([at([cx1 + 2.2, y, z])], { size: 0.5 }) });
  }
  // Traba de seguridad: la uña que entra en las ventanas de la columna.
  caja(`${nombre}.traba`, [cx1, y - 3, CARRO_Z[1] - 5], [cx1 + 2.6, y + 3, CARRO_Z[1] + 2], { tone: "lo" }, { owner: nombre });

  // Brazos: pivote con su corona dentada, dos tramos telescópicos y taco.
  for (const px of TACOS_X) {
    const lado = px > POSTE_X ? 1 : -1;
    const piv = [POSTE_X + lado * 6.5, y + hacia * 15.5];
    const taco = [px, hacia * -TACO_Y];
    const yCara = y + hacia * 10;
    const ow = `${nombre}.brazo${lado}`;
    const dir = G.unit3([taco[0] - piv[0], taco[1] - piv[1], 0]);
    const largo = Math.hypot(taco[0] - piv[0], taco[1] - piv[1]);
    const corte = [piv[0] + dir[0] * largo * 0.56, piv[1] + dir[1] * largo * 0.56];
    const antes = [corte[0] - dir[0] * 2, corte[1] - dir[1] * 2];
    const despues = [corte[0] + dir[0], corte[1] + dir[1]];
    const n = [-dir[1] * 4.5, dir[0] * 4.5];
    const anillo = [[piv[0] + n[0], piv[1] + n[1]], [antes[0] + n[0], antes[1] + n[1]], [antes[0] - n[0], antes[1] - n[1]], [piv[0] - n[0], piv[1] - n[1]]];
    const oreja = { x: piv[0] - 4.5, y: Math.min(yCara, piv[1]), w: 9, d: Math.abs(piv[1] - yCara), r: 0.5 };
    const FP = ejeZ(piv[0], piv[1], BRAZO_Z[0] - 3);
    const t = k.radialTicks(piv[0], piv[1], 4.6, 24, 4, BRAZO_Z[1] + 3, [0.8, 1.4], P);
    put(`${ow}.raiz`, [piv[0], piv[1], BRAZO_Z[1]],
      S(k.slabOf(oreja, BRAZO_Z[0] - 3, BRAZO_Z[1] - BRAZO_Z[0] + 6, P, 2, 0.4), { tone: "mid" })
        + S(k.extrude(anillo, BRAZO_Z[0], BRAZO_Z[1] - BRAZO_Z[0], P, { bevel: 0.4 }), { tone: "mid" })
        + S(G.solidOf([[0, 5.2], [12, 5.2]], FP, P), { tone: "hi", crease: "lo" })
        + Ln(t.minor, { tone: "lo" }) + Ln(t.major, { tone: "mid" }) + Ln(k.ring(piv[0], piv[1], 2.4, BRAZO_Z[1] + 3, P, 14), { tone: "lo" }) + Dots([at([piv[0], piv[1], BRAZO_Z[1] + 3])], { size: 0.6 }),
      [R.solid(A.slab(oreja, BRAZO_Z[0] - 3, BRAZO_Z[1] - BRAZO_Z[0] + 6, { name: `${ow}.oreja`, owner: ow }, 2)), R.solid(A.extruded(anillo, BRAZO_Z[0], BRAZO_Z[1] - BRAZO_Z[0], { name: `${ow}.1`, owner: ow })), R.solid(A.solid(FP, [[0, 5.2], [12, 5.2]], { name: `${ow}.pivote`, owner: ow }))]);
    viga(`${ow}.collar`, antes, despues, 10.4, BRAZO_Z[0] - 0.6, BRAZO_Z[1] + 0.6, { tone: "lo" }, { owner: ow });
    const puntaB = [taco[0] + dir[0] * 4, taco[1] + dir[1] * 4];
    viga(`${ow}.2`, despues, puntaB, 6.6, BRAZO_Z[0] + 0.8, BRAZO_Z[1] - 0.8, { tone: "mid" }, { owner: ow });
    // Taco roscado: base, tuerca moleteada, goma.
    const zb = BRAZO_Z[1] - 0.8;
    torneado(`${nombre}.taco${lado}`, ejeZ(taco[0], taco[1], zb), [[0, 3.4], [1.6, 3.4], [1.6, 5.4], [3.8, 5.4], [3.8, 3.2], [5.6, 3.2], [5.6, 6.8], [Z_TACO - zb, 6.8]], { tone: "hi", crease: "lo" }, {
      owner: ow,
      extra: Ln(k.knurl(taco[0], taco[1], 5.4, zb + 1.6, zb + 3.8, 26, P, 0.25), { tone: "lo" }),
    });
  }

  if (conGrupo) grupoHidraulico(y);
}

// Travesaño superior con su bandeja, la barra de corte y las placas de fijación.
function travesano() {
  const z = COL_ALTO;
  for (const y of [-POSTE_Y, POSTE_Y]) {
    const p = { x: POSTE_X - 11, y: y - 9, w: 22, d: 18, r: 1 };
    caja(`travesano.placa${y}`, [p.x, p.y, z], [p.x + p.w, p.y + p.d, z + 3], { tone: "lo" }, { extra: tornillos(p, 3, z + 3, 1.2) });
  }
  const yv = POSTE_Y - 9;
  const lineas = [POSTE_X - 3, POSTE_X + 3].map((x) => k.segment([x, -yv, z + 13], [x, yv, z + 13], P)).join("");
  caja("travesano.viga", [POSTE_X - 6, -yv, z + 3], [POSTE_X + 6, yv, z + 13], { tone: "mid" }, { bevel: 0.5, extra: Ln(lineas, { tone: "faint" }) });
  // Barra de corte: si el techo la toca, se corta la subida.
  for (const y of [-58, 58]) caja(`travesano.colgante${y}`, [POSTE_X - 1, y - 1, z - 12], [POSTE_X + 1, y + 1, z + 3], { tone: "lo" });
  torneado("travesano.barra", ejeY(POSTE_X, -66, z - 13), [[0, 1.2], [132, 1.2]], { tone: "lo" });
}

// Motor, depósito y mando, en la cara exterior del poste de adelante.
function grupoHidraulico(y) {
  const x = POSTE_X;
  const y0 = y + COL_D / 2;
  caja("grupo.soporte", [x - 8, y0, 94], [x + 8, y0 + 3, 128], { tone: "lo" }, { extra: Dots([at([x - 6, y0 + 3, 97]), at([x + 6, y0 + 3, 97]), at([x - 6, y0 + 3, 125]), at([x + 6, y0 + 3, 125])], { size: 0.45 }) });
  const yc = y0 + 3;
  // Depósito de aceite, con su visor.
  const dep = { x: x - 7, y: yc, w: 14, d: 15, r: 1 };
  caja("grupo.deposito", [dep.x, dep.y, 70], [dep.x + dep.w, dep.y + dep.d, 92], { tone: "mid" }, {
    inner: Ln(k.sideSeam(dep, 74, P, 2), { tone: "faint" }),
    extra: Ln(trazo([[dep.x + dep.w, dep.y + 6, 76], [dep.x + dep.w, dep.y + 9, 76], [dep.x + dep.w, dep.y + 9, 88], [dep.x + dep.w, dep.y + 6, 88]], true), { tone: "mid" }),
  });
  caja("grupo.bloque", [x - 7, yc, 92], [x + 7, yc + 15, 97], { tone: "lo" });
  // Motor eléctrico, con su carcasa aleteada.
  const F = ejeZ(x, yc + 7.5, 97);
  torneado("grupo.motor", F, [[0, 7.2], [27, 7.2], [27, 5], [30, 3.4]], { tone: "mid" }, {
    extra: Ln(k.knurl(x, yc + 7.5, 7.2, 101, 120, 30, P, 0.5), { tone: "lo" }) + Ln(k.sideArc(x, yc + 7.5, 7.2, 101, P, 28) + k.sideArc(x, yc + 7.5, 7.2, 120, P, 28), { tone: "lo" }),
  });
  // Caja de mando con botonera, colgada del costado de la columna.
  const mando = { x: x + COL_W / 2, y: y - 6, w: 11, d: 12, r: 0.8 };
  caja("grupo.mando", [mando.x, mando.y, 102], [mando.x + mando.w, mando.y + mando.d, 124], { tone: "hi", crease: "lo" }, {
    inner: Ln(k.sideSeam(mando, 106, P, 2), { tone: "faint" }),
    extra: Ln(k.planOutline(k.insetPlan(mando, 1.6), 124, P, 2), { tone: "lo" }),
  });
  for (const z of [110, 115, 120]) {
    const FB = ejeY(mando.x + 5.5, mando.y + mando.d, z);
    put(`grupo.boton${z}`, [mando.x + 5.5, mando.y + mando.d + 0.5, z], S(G.disc(0, 0.9, 1.7, FB, P, { steps: 16 }), { tone: "hi" }), [R.solid(A.disc(FB, 0, 0.9, 1.7, { name: `grupo.boton${z}`, owner: "grupo.mando" }))]);
  }
  // Manguera de presión: del bloque a la entrada del cilindro, al pie de la columna.
  caja("grupo.entrada", [x - 1, y0, 18], [x + 7, y0 + 8, 24], { tone: "lo" });
  manguera("grupo.presion", [[x + 3, y0 + 5, 70], [x + 3, y0 + 5, 24]], 1);
}

// ── Sedán ──────────────────────────────────────────────────────────────────
// Local del auto: x a lo largo con la trompa hacia +x, y a lo ancho, z desde el piso
// sobre el que apoyaría. Se levanta sumando SUBIDA.
const lineaTop = curva([[-112, 33], [-110, 42], [-104, 47.5], [-84, 50], [-60, 50.2], [-20, 49.6], [20, 49], [46, 48], [70, 45.8], [94, 41], [106, 35], [112, 27]]);
const lineaBaja = curva([[-112, 15], [-98, 10], [-82, SOLERA], [88, SOLERA], [104, 11], [112, 16]]);
const mitad = (x) => {
  const f = x > 88 ? ((x - 88) / 24) ** 2.2 * 13 : 0;
  const t = x < -92 ? ((-x - 92) / 20) ** 2.2 * 10 : 0;
  return COCHE_W - f - t;
};
function zBaja(x) {
  for (const ax of [EJE_D, EJE_T]) {
    const d = x - ax;
    if (Math.abs(d) <= ARCO_R) return ARCO_Z + Math.sqrt(ARCO_R * ARCO_R - d * d);
  }
  return lineaBaja(x);
}
const up = ([x, y, z]) => [x, y, z + SUBIDA];

function seccion(x) {
  const w = mitad(x);
  const zt = lineaTop(x);
  const zb = zBaja(x);
  const cerca = [[w - 3, zb], [w, zb + 2.5], [w, zt - 6], [w - 2.2, zt - 1.6], [w - 8, zt]];
  return [...cerca, ...[...cerca].reverse().map(([y, z]) => [-y, z])].map(([y, z]) => up([x, y, z]));
}

function estaciones() {
  const xs = new Set();
  for (let x = -104; x <= 104; x += 6) xs.add(x);
  for (const x of [-112, -111.2, -110, -108.5, -106.5, 106.5, 108.5, 110, 111.2, 112]) xs.add(x);
  for (const ax of [EJE_D, EJE_T]) {
    for (let g = 0; g <= 180; g += 9) xs.add(+(ax + ARCO_R * Math.cos(rad(g))).toFixed(3));
    xs.add(ax - ARCO_R - 0.04);
    xs.add(ax + ARCO_R + 0.04);
  }
  return [...xs].sort((a, b) => a - b);
}

// Puntos sobre el costado cercano de la carrocería.
const lado = (x, z) => up([x, mitad(x) + 0.02, z]);
// Sigue el hombro desde el costado hasta la base del habitáculo.
const hombro = (x) => {
  const w = mitad(x);
  const zt = lineaTop(x);
  return [[x, w, zt - 6], [x, w - 2.2, zt - 1.6], [x, w - 8, zt], [x, HAB_W + 0.1, zt]].map(up);
};

// Habitáculo: parabrisas y luneta inclinados, y costados que se cierran hacia el
// techo. Es lo que le da forma de auto y no de caja sobre una caja.
const CAIDA = 7 / 26;
const anchoHab = (z) => HAB_W - CAIDA * (z - 49);
const PERFIL_HAB = [[50, lineaTop(50) - 0.8], [13, 73], [-10, 76], [-44, 75], [-55, 71.5], [-88, lineaTop(-88) - 0.8]];
const CHAFLAN = 1.6;
const perfilHab = G.fillet(PERFIL_HAB.map(([x, z]) => [x, 0, z]), 9, 7).map(([x, , z]) => [x, z]);

function normalPerfil(lista, i) {
  const a = lista[Math.max(0, i - 1)];
  const b = lista[Math.min(lista.length - 1, i + 1)];
  const n = G.unit3([b[1] - a[1], 0, a[0] - b[0]]);
  return [n[0], n[2]];
}
const adentro = (lista, i, d) => {
  const n = normalPerfil(lista, i);
  return [lista[i][0] - n[0] * d, lista[i][1] - n[1] * d];
};

function carasHabitaculo() {
  const n = perfilHab.length;
  const borde = perfilHab.map((_, i) => (i === 0 || i === n - 1 ? perfilHab[i] : adentro(perfilHab, i, CHAFLAN)));
  const caras = [];
  for (let i = 0; i < n - 1; i++) {
    const [a, b] = [perfilHab[i], perfilHab[i + 1]];
    const [qa, qb] = [borde[i], borde[i + 1]];
    const ha = anchoHab(a[1]) - 3;
    const hb = anchoHab(b[1]) - 3;
    caras.push([[a[0], ha, a[1]], [b[0], hb, b[1]], [b[0], -hb, b[1]], [a[0], -ha, a[1]]].map(up));
    for (const s of [1, -1]) caras.push([[a[0], s * ha, a[1]], [qa[0], s * anchoHab(qa[1]), qa[1]], [qb[0], s * anchoHab(qb[1]), qb[1]], [b[0], s * hb, b[1]]].map(up));
  }
  for (const s of [1, -1]) caras.push(borde.map(([x, z]) => up([x, s * anchoHab(z), z])));
  return caras;
}

// Paños de vidrio sobre el plano del costado.
const enCostado = ([x, z]) => up([x, anchoHab(z) + 0.03, z]);
function vidrios() {
  const interior = perfilHab.map((_, i) => adentro(perfilHab, i, 4)).filter(([x, z]) => z > lineaTop(x) + 3.5);
  const pie = [];
  const [xa, xb] = [interior[interior.length - 1][0], interior[0][0]];
  for (let i = 0; i <= 8; i++) {
    const x = xa + ((xb - xa) * i) / 8;
    pie.push([x, lineaTop(x) + 3.5]);
  }
  const dlo = [...interior, ...pie];
  const banda = (poli, x0, x1) => recortar(recortar(poli, ([x, z]) => x - (x0 + (z - 55) * 0.12)), ([x, z]) => x1 + (z - 55) * 0.12 - x);
  const panos = [banda(dlo, -11, 60), banda(dlo, -57, -15), banda(dlo, -100, -61)];
  let svg = "";
  for (const pano of panos) {
    svg += relleno("vidrio", pano.map(enCostado));
    const c = pano.reduce((s, p) => s + p[0], 0) / pano.length;
    const reflejo = recortar(recortar(pano, ([x, z]) => x + (z - 60) * 0.9 - (c - 7)), ([x, z]) => c - 1 - (x + (z - 60) * 0.9));
    if (reflejo.length > 2) svg += relleno("reflejo", reflejo.map(enCostado));
    svg += Ln(trazo(pano.map(enCostado), true), { tone: "mid" });
  }
  // Parabrisas y luneta, cada uno sobre su cara inclinada.
  const inclinado = ([ax, az], [bx, bz], s0, s1) => {
    const p = (s) => [ax + (bx - ax) * s, az + (bz - az) * s];
    const m = (z) => anchoHab(z) - 5.2;
    const c = 3;
    const a = p(s0);
    const a2 = p(s0 + 0.06);
    const b2 = p(s1 - 0.06);
    const b = p(s1);
    return [[a[0], m(a[1]) - c, a[1]], [a2[0], m(a2[1]), a2[1]], [b2[0], m(b2[1]), b2[1]], [b[0], m(b[1]) - c, b[1]],
      [b[0], -m(b[1]) + c, b[1]], [b2[0], -m(b2[1]), b2[1]], [a2[0], -m(a2[1]), a2[1]], [a[0], -m(a[1]) + c, a[1]]].map(([x, y, z]) => up([x, y, z + 0.03]));
  };
  const parab = inclinado(PERFIL_HAB[0], PERFIL_HAB[1], 0.06, 0.8);
  svg += relleno("vidrio", parab) + Ln(trazo(parab, true), { tone: "mid" });
  const luneta = inclinado(PERFIL_HAB[5], PERFIL_HAB[4], 0.12, 0.84);
  svg += relleno("vidrio", luneta) + Ln(trazo(luneta, true), { tone: "mid" });
  // Limpiaparabrisas: varilla apoyada en el vidrio, con su pivote.
  const lerpW = (s, y) => {
    const [a, b] = [PERFIL_HAB[0], PERFIL_HAB[1]];
    return up([a[0] + (b[0] - a[0]) * s, y, a[1] + (b[1] - a[1]) * s + 0.05]);
  };
  for (const y0 of [24, -4]) {
    const a = lerpW(0.09, y0);
    const b = lerpW(0.3, y0 - 25);
    svg += Ln(k.pathOf([at(a), at(b)]), { tone: "lo", free: "end" }) + Dots([at(a)], { size: 0.6 });
  }
  return svg;
}

function detallesCarroceria() {
  let d = "";
  // Línea baja del zócalo, de un paso de rueda al otro.
  d += trazo([lado(EJE_D - ARCO_R, 14.5), lado(EJE_T + ARCO_R, 14.5)]);
  // Cortes de las puertas: suben por el costado, cruzan el hombro y llegan al vidrio.
  d += trazo([lado(47, 14.5), lado(46.5, 30), ...hombro(45.5)]);
  d += trazo([lado(-12, 14.5), ...hombro(-12)]);
  const arcoP = [];
  for (let g = 0; g <= 72; g += 8) arcoP.push(lado(EJE_T + 23.5 * Math.cos(rad(g)), ARCO_Z + 23.5 * Math.sin(rad(g))));
  d += trazo([lado(EJE_T + 23.5, 14.5), ...arcoP, ...hombro(EJE_T + 7.3)]);
  // Corte de los paragolpes, que da la vuelta a la esquina.
  const dz = Math.sqrt(ARCO_R ** 2 - (22 - 2.5 - ARCO_Z) ** 2);
  const bumper = [];
  for (let x = EJE_D + dz; x <= 112; x += 2) bumper.push(lado(x, 22));
  const wF = mitad(112);
  d += trazo([...bumper, up([112.03, wF, 22]), up([112.03, -wF, 22])]);
  const traseros = [];
  for (let x = EJE_T - dz; x >= -112; x -= 2) traseros.push(lado(x, 22));
  d += trazo(traseros);
  // Capó y tapa del baúl: una línea cerrada sobre la cara de arriba.
  const superficie = (x, y) => up([x, y, lineaTop(x) + 0.04]);
  const anilloTop = (x0, x1, inset) => {
    const pts = [];
    for (let x = x0; x <= x1; x += 4) pts.push(superficie(x, mitad(x) - inset));
    for (let x = x1; x >= x0; x -= 4) pts.push(superficie(x, -(mitad(x) - inset)));
    return trazo(pts, true);
  };
  d += anilloTop(52, 104, 9);
  d += anilloTop(-104, -90, 9);
  // Los dos pliegues del capó, de un borde del capó al otro.
  d += trazo([superficie(52, 18), superficie(104, 11)]) + trazo([superficie(52, -18), superficie(104, -11)]);
  return Ln(d, { tone: "lo" });
}

function frente() {
  const X = 112.04;
  let s = "";
  // Parrilla sobre el corte del paragolpes, boca con sus barras y patente debajo.
  const parrilla = [[X, 19, 26.2], [X, 21, 23], [X, -21, 23], [X, -19, 26.2]].map(up);
  s += relleno("cavo", parrilla) + Ln(trazo(parrilla, true), { tone: "mid" });
  const boca = [[X, 24, 21], [X, 22, 17], [X, -22, 17], [X, -24, 21]].map(up);
  s += relleno("cavo", boca);
  let barras = "";
  for (let i = 1; i < 11; i++) {
    const y = -22 + i * (44 / 11);
    barras += trazo([up([X, y * (24 / 22), 21]), up([X, y, 17])]);
  }
  s += Ln(barras, { tone: "lo" }) + Ln(trazo(boca, true), { tone: "lo" });
  const pat = [[X + 0.02, 8, 20.2], [X + 0.02, 8, 17.8], [X + 0.02, -8, 17.8], [X + 0.02, -8, 20.2]].map(up);
  s += relleno("patente", pat) + Ln(trazo(pat, true), { tone: "mid" });
  // Faro: sigue la línea del capó por el costado y dobla la esquina hasta la parrilla.
  const xsF = [92, 96, 100, 103, 106, 108.5, 110.5, 111.8];
  const arriba = xsF.map((x) => up([x, mitad(x) + 0.03, lineaTop(x) - 2.2]));
  const abajo = xsF.map((x) => up([x, mitad(x) + 0.03, Math.max(lineaTop(x) - 2.2 - Math.min(5, (x - 92) * 0.9), 23.4)]));
  const faro = [...arriba, up([X, 22, lineaTop(112) - 0.8]), up([X, 22, 23.4]), ...[...abajo].reverse().slice(0, -1)];
  s += relleno("faro", faro) + Ln(trazo(faro, true), { tone: "hi" });
  return s;
}

function accesorios() {
  let s = "";
  // Manijas: un rectángulo redondeado cerrado, a la altura de la cintura.
  for (const x of [30, -32]) {
    const z = lineaTop(x) - 10;
    const pts = [[x + 5, z + 1], [x + 5.6, z], [x + 5, z - 1], [x - 5, z - 1], [x - 5.6, z], [x - 5, z + 1]].map(([u, v]) => lado(u, v));
    s += relleno("patente", pts) + Ln(trazo(pts, true), { tone: "mid" });
  }
  // Tapa de combustible y techo solar.
  const tapa = [];
  for (let g = 0; g < 360; g += 12) tapa.push(lado(-92 + 4 * Math.cos(rad(g)), 38 + 4 * Math.sin(rad(g))));
  s += Ln(trazo(tapa, true), { tone: "lo" });
  const xsO = [-107, -104, -100, -96];
  const optica = [...xsO.map((x) => lado(x, lineaTop(x) - 2.6)), ...[...xsO].reverse().map((x) => lado(x, lineaTop(x) - 8))];
  s += relleno("faro", optica) + Ln(trazo(optica, true), { tone: "mid" });
  const techo = curva([...perfilHab].reverse());
  const sun = [[0, 17], [-34, 17], [-34, -17], [0, -17]].map(([x, y]) => up([x, y, techo(x) + 0.04]));
  s += Ln(trazo(sun, true), { tone: "lo" });
  // Aleta de antena sobre el techo.
  const FA = G.frameOf(up([-46, 0, techo(-46)]), [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  s += S(G.prismOf(FA, [[-5, 0], [3, 0], [-3, 3.6]], -0.8, 0.8, P), { tone: "mid" });
  return s;
}

function espejo() {
  const x = 40;
  const z = lineaTop(x) + 5;
  const yb = HAB_W - CAIDA * 5;
  const brazo = S(k.slabOf({ x: x - 1, y: yb - 0.4, w: 3.4, d: 6.4, r: 0.4 }, z + SUBIDA + 0.8, 1.6, P, 2, 0.2), { tone: "mid" });
  const cuerpo = S(k.slabOf({ x: x - 2.4, y: yb + 5.6, w: 5, d: 8, r: 1.4 }, z + SUBIDA - 1, 5.4, P, 3, 0.5), { tone: "hi", crease: "lo" });
  return brazo + cuerpo;
}

// Una rueda con su llanta de cinco rayos. La cara `s = +7` es la que se ve.
function rueda(name, F, { detalle = true, owner = "coche", bias = 0 } = {}) {
  const r = RUEDA_R;
  const w = RUEDA_ANCHO / 2;
  const perfil = [[-w, 11.8], [-w, r - 2.2, 1], [-w + 1.6, r - 0.5, 1], [-w + 3, r], [w - 3, r], [w - 1.6, r - 0.5, 1], [w, r - 2.2, 1], [w, 11.8]];
  let svg = S(G.solidOf(perfil, F, P), { tone: "mid" });
  svg += Ln(G.ribsOf(F, -w + 3, w - 3, r, 72, P, { least: 0.08, seams: true }), { tone: "faint" });
  for (const s of [-1.6, 1.6]) svg += Ln(G.arcOf(F, s, r, P), { tone: "lo" });
  if (detalle) {
    svg += `<path class="cavo" d="${G.circleOf(F, w, 11.6, P)}"/>`;
    svg += Ln(G.circleOf(F, w - 3.4, 9.6, P), { tone: "lo" }) + Ln(G.circleOf(F, w - 3.4, 5.2, P), { tone: "faint" });
    for (let i = 0; i < 5; i++) {
      const a = rad(i * 72 + 18);
      const giro = ([u, v]) => [u * Math.cos(a) - v * Math.sin(a), u * Math.sin(a) + v * Math.cos(a)];
      svg += S(G.prismOf(F, [[2.8, -1.9], [11.2, -0.9], [11.2, 0.9], [2.8, 1.9]].map(giro), w - 1.6, w - 0.5, P), { tone: "hi", crease: "lo" });
    }
    svg += S(G.ringBand(w - 1.2, w + 0.1, 11, 12.4, F, P, { steps: 56 }), { tone: "hi", crease: "lo" });
    svg += S(G.disc(w - 1.4, w + 0.1, 3.6, F, P, { steps: 24 }), { tone: "hi", crease: "lo" });
    svg += Ln(G.circleOf(F, w + 0.1, 1.7, P), { tone: "lo" }) + Dots(G.dotsOf(F, w + 0.1, 2.7, 5, P, { all: true, phase: rad(18) }), { size: 0.5 });
    svg += Ln(G.circleOf(F, w, 14.1, P), { tone: "lo" });
  }
  const shape = R.solid(A.disc(F, -w, w, r, { name, owner }));
  put(name, F.o, svg, [shape], { bias });
}

// Prisma de sección cóncava, que `prismOf` no admite.
function mallaPrisma(F, poli, s0, s1) {
  const p = ([u, v], s) => [F.o[0] + F.a[0] * s + F.u[0] * u + F.v[0] * v, F.o[1] + F.a[1] * s + F.u[1] * u + F.v[1] * v, F.o[2] + F.a[2] * s + F.u[2] * u + F.v[2] * v];
  const caras = [poli.map((q) => p(q, s0)), poli.map((q) => p(q, s1))];
  poli.forEach((q, i) => {
    const r = poli[(i + 1) % poli.length];
    caras.push([p(q, s0), p(r, s0), p(r, s1), p(q, s1)]);
  });
  const cx = poli.reduce((s, q) => s + q[0], 0) / poli.length;
  const cy = poli.reduce((s, q) => s + q[1], 0) / poli.length;
  return malla(caras, P, { centro: p([cx, cy], (s0 + s1) / 2), pliegue: 24 });
}

// La esquina abierta: disco, mordaza, maza, amortiguador con su espiral y parrilla.
function frenoDelantero() {
  const x = EJE_D;
  const z = RUEDA_Z + SUBIDA;
  const y = 36;
  const F = ejeY(x, y, z);
  // Mangueta, y encima el amortiguador con su espiral, que sube hacia la torre.
  caja("freno.mangueta", [x - 4, 24, z - 9], [x + 4, y - 1.2, z + 10], { tone: "mid" }, { owner: "coche" });
  const yS = 28;
  const FS = ejeZ(x - 1, yS, z + 10);
  const perfilS = [[0, 2.6], [1.6, 2.6], [1.6, 5], [2.3, 5], [2.3, 1.4], [10, 1.4]];
  const espiral = (desde, hasta, r, vueltas) => {
    const [atras, frente] = [[], []];
    let tramo = [];
    let cerca = null;
    const corte = () => { if (tramo.length > 1) (cerca ? frente : atras).push(k.pathOf(tramo)); };
    for (let i = 0; i <= vueltas * 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const q = at([x - 1 + r * Math.cos(a), yS + r * Math.sin(a), desde + ((hasta - desde) * i) / (vueltas * 24)]);
      const mira = Math.cos(a) * 0.42 + Math.sin(a) * 0.79 > 0;
      if (cerca !== null && mira !== cerca) { tramo.push(q); corte(); tramo = [q]; cerca = mira; continue; }
      cerca = mira;
      tramo.push(q);
    }
    corte();
    return [atras.join(""), frente.join("")];
  };
  const [resAtras, resFrente] = espiral(z + 12.4, z + 19.8, 4.2, 3);
  put("freno.amortiguador", [x - 1, yS, z + 20], Ln(resAtras, { tone: "lo", free: true }) + S(G.solidOf(perfilS, FS, P), { tone: "mid" }) + Ln(resFrente, { tone: "mid", free: true }), [R.solid(A.solid(FS, perfilS, { name: "freno.amortiguador", owner: "coche" }))]);
  viga("freno.parrilla", [x - 3, 24], [x + 2, 12], 5, z - 11, z - 7, { tone: "lo" }, { owner: "coche" });
  // Semieje con su fuelle: los anillos le dan el corrugado.
  const FE = G.frameOf([x, 24, z], [0, -1, 0], [1, 0, 0], [0, 0, 1]);
  torneado("freno.semieje", FE, [[0, 3.6], [1, 3.6], [1.6, 2.6], [2.2, 3.6], [2.8, 2.6], [3.4, 3.6], [4, 2.6], [4.6, 3.6], [5.4, 2], [12, 2]], { tone: "lo" }, { owner: "coche" });
  // Disco: el único acento encendido de la figura.
  const huella = Ln(G.circleOf(F, 1.2, 10.8, P) + G.circleOf(F, 1.2, 6.2, P), { tone: "lo" });
  const shape = R.solid(A.disc(F, -1.2, 1.2, 12.4, { name: "freno.disco", owner: "coche" }));
  put("freno.disco", F.o, S(G.disc(-1.2, 1.2, 12.4, F, P, { steps: 96 }), { tone: "hi", lit: true, inner: huella }), [shape]);
  const FM2 = ejeY(x, y + 1.2, z);
  torneado("freno.maza", FM2, [[0, 6], [2.2, 6], [2.2, 3.4], [4.4, 3.4]], { tone: "hi", crease: "lo" }, {
    owner: "coche",
    extra: Dots(G.dotsOf(FM2, 2.2, 4.8, 5, P, { all: true, phase: rad(18) }), { size: 0.55, tone: "hi" }) + Ln(G.circleOf(FM2, 4.4, 1.6, P), { tone: "lo" }),
  });
  // Mordaza abrazando el disco por detrás y arriba.
  const a0 = rad(112);
  const a1 = rad(172);
  const poli = [];
  for (let i = 0; i <= 6; i++) {
    const a = a0 + ((a1 - a0) * i) / 6;
    poli.push([13.8 * Math.cos(a), 13.8 * Math.sin(a)]);
  }
  for (let i = 6; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / 6;
    poli.push([7.6 * Math.cos(a), 7.6 * Math.sin(a)]);
  }
  const shapeM = R.solid(A.prism(F, poli, 1.2, 3.8, { name: "freno.mordaza", owner: "coche" }));
  put("freno.mordaza", G.pointOf(F, 2.5, 10.7, (a0 + a1) / 2), S(mallaPrisma(F, poli, 1.2, 3.8), { tone: "hi", crease: "lo" }) + Dots([at(G.pointOf(F, 3.8, 10.7, a0 + 0.2)), at(G.pointOf(F, 3.8, 10.7, a1 - 0.2))], { size: 0.6, tone: "hi" }), [shapeM]);
}

function coche() {
  // Piso del auto: lo que se ve por el paso de rueda abierto, detrás de la llanta.
  const XZ0 = G.frameOf([0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  for (const ax of [EJE_T, EJE_D]) {
    const poli = [];
    for (let g = 0; g <= 180; g += 15) poli.push([ax + (ARCO_R - 0.3) * Math.cos(rad(g)), SUBIDA + ARCO_Z + (ARCO_R - 0.3) * Math.sin(rad(g))]);
    poli.push([ax - ARCO_R + 0.3, Z_TACO + 0.3], [ax + ARCO_R - 0.3, Z_TACO + 0.3]);
    const name = `coche.pared${ax}`;
    put(name, [ax, 11, SUBIDA + 22], S(mallaPrisma(XZ0, poli, 10, 12), { tone: "lo" }), [R.solid(A.prism(XZ0, poli, 10, 12, { name, owner: "coche" }))]);
  }

  // Ruedas: las del fondo apenas asoman, la trasera cercana se ve entera.
  rueda("coche.rueda.tt", ejeY(EJE_T, -36, RUEDA_Z + SUBIDA), { detalle: false });
  rueda("coche.rueda.dt", ejeY(EJE_D, -36, RUEDA_Z + SUBIDA), { detalle: false });
  rueda("coche.rueda.tc", ejeY(EJE_T, 37, RUEDA_Z + SUBIDA));
  for (const [x, y0, largo] of [[EJE_T, 12, 31], [EJE_T, -43, 53], [EJE_D, -43, 53]]) R.solid(A.disc(ejeY(x, y0, RUEDA_Z + SUBIDA), 0, largo, 3, { name: `coche.eje${x}${y0}`, owner: "coche" }));
  frenoDelantero();

  // La carrocería: secciones a lo largo del auto. Los pasos de rueda están recortados
  // en la propia sección, así que son agujeros de verdad y no un dibujo encima.
  const xs = estaciones();
  const filas = xs.map(seccion);
  const caras = [];
  for (let i = 0; i < filas.length - 1; i++) {
    for (let j = 1; j < 8; j++) caras.push([filas[i][j], filas[i + 1][j], filas[i + 1][(j + 1) % 10], filas[i][(j + 1) % 10]]);
  }
  caras.push(filas[0], filas[filas.length - 1]);
  const casco = malla(caras, P, { centro: up([0, 0, 30]), pliegue: 20 });

  const silueta = [];
  for (const x of xs) silueta.push([x, zBaja(x) + SUBIDA]);
  for (const x of [...xs].reverse()) silueta.push([x, lineaTop(x) + SUBIDA]);
  const techoChapa = [];
  for (const x of xs) techoChapa.push([x, lineaTop(x) + SUBIDA - 9.5]);
  for (const x of [...xs].reverse()) techoChapa.push([x, lineaTop(x) + SUBIDA]);
  const XZ = G.frameOf([0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  const formas = [
    R.solid(A.prism(XZ, silueta, COCHE_W - 2, COCHE_W, { name: "coche.costado", owner: "coche" })),
    R.solid(A.prism(XZ, techoChapa, -COCHE_W, COCHE_W, { name: "coche.capot", owner: "coche" })),
    R.solid(A.prism(XZ, perfilHab.map(([x, z]) => [x, z + SUBIDA]), -HAB_W, HAB_W, { name: "coche.habitaculo", owner: "coche" })),
  ];
  R.solid(A.box([EJE_T + ARCO_R - 0.5, -COCHE_W, Z_TACO], [EJE_D - ARCO_R + 0.5, COCHE_W, Z_TACO + 1.5], { name: "coche.fondo", owner: "coche" }));
  const hab = malla(carasHabitaculo(), P, { centro: up([-20, 0, 55]), pliegue: 14 });
  const svg = S(casco, { tone: "hi", crease: "lo", inner: detallesCarroceria() + frente() })
    + S(hab, { tone: "hi", crease: "lo" })
    + vidrios() + accesorios() + espejo();
  put("coche.carroceria", up([0, 0, 42]), svg, formas);
}

// ── Lo que rodea al elevador ───────────────────────────────────────────────
function cajon(x, ancho, yf, z, alto) {
  const fr = { x, y: yf, w: ancho, d: 1, r: 0.3 };
  let s = S(k.slabOf(fr, z, alto - 0.8, P, 1, 0.2), { tone: "hi", crease: "lo" });
  // Portaetiqueta y tirador.
  s += Ln(trazo([[x + 3, yf + 1, z + alto - 4.4], [x + 13, yf + 1, z + alto - 4.4], [x + 13, yf + 1, z + alto - 2], [x + 3, yf + 1, z + alto - 2]], true), { tone: "lo" });
  const tir = { x: x + ancho - 22, y: yf + 1, w: 18, d: 1.6, r: 0.5 };
  s += S(k.slabOf(tir, z + alto - 4.6, 1.5, P, 2, 0.2), { tone: "mid" });
  return s;
}

function carroHerramientas() {
  const c = { x: -168, y: 58, w: 62, d: 32, r: 1.2 };
  const zc = 7;
  const zt = 62;
  fondo.push(`<path class="iso-halo" d="${k.haloOf(c, 0, zc, P)}"/>`);
  let ruedas = "";
  for (const [x, y] of porFondo(k.corners(c, 6))) {
    ruedas += S(k.slabOf({ x: x - 3, y: y - 3, w: 6, d: 6, r: 0.6 }, 5.2, zc - 5.2, P, 2), { tone: "lo" });
    ruedas += S(G.disc(-1.2, 1.2, 2.8, ejeY(x, y, 2.8), P, { steps: 20 }), { tone: "lo" });
    R.solid(A.disc(ejeZ(x, y, 0), 0, zc, 3, { name: `carro.rueda${x}${y}`, owner: "carro" }));
  }
  const tapaP = { x: c.x - 1.4, y: c.y - 1.4, w: c.w + 2.8, d: c.d + 2.8, r: 1.4 };
  const formas = [R.solid(A.slab(c, zc, zt - zc, { name: "carro.cuerpo", owner: "carro" }, 3)), R.solid(A.slab(tapaP, zt, 2.6, { name: "carro.tapa", owner: "carro" }, 3))];
  let s = ruedas + S(k.slabOf(c, zc, zt - zc, P, 3, 0.8), { tone: "mid", inner: Ln(k.sideSeam(c, zc + 3, P, 3), { tone: "faint" }) });
  const yf = c.y + c.d;
  let z = zc + 4;
  for (const alto of [13, 10, 8, 6.4, 6.4, 5.2]) {
    s += cajon(c.x + 2, c.w - 4, yf, z, alto);
    z += alto + 0.3;
  }
  // Rejilla de ventilación al costado.
  let rejilla = "";
  for (let i = 0; i < 5; i++) rejilla += trazo([[c.x + c.w, c.y + 7, 18 + i * 4], [c.x + c.w, c.y + 25, 18 + i * 4], [c.x + c.w, c.y + 25, 19.6 + i * 4], [c.x + c.w, c.y + 7, 19.6 + i * 4]], true);
  s += Ln(rejilla, { tone: "lo" });
  const tapa = { x: c.x - 1.4, y: c.y - 1.4, w: c.w + 2.8, d: c.d + 2.8, r: 1.4 };
  s += S(k.slabOf(tapa, zt, 2.6, P, 3, 0.5), { tone: "hi", crease: "lo" });
  s += Ln(k.planOutline(k.insetPlan(tapa, 3), zt + 2.6, P, 3), { tone: "lo" });
  put("carro", [c.x + 31, c.y + 16, 30], s, formas);
  // Lo que quedó arriba: un vaso y la llave de torque.
  torneado("carro.vaso", ejeZ(c.x + 14, c.y + 15, zt + 2.6), [[0, 3], [2, 3], [2, 2.2], [6.6, 2.2]], { tone: "mid" }, { owner: "carro", extra: Ln(k.ring(c.x + 14, c.y + 15, 1.3, zt + 2.6 + 6.6, P, 12), { tone: "lo" }) });
  const mango = { x: c.x + 28.5, y: c.y + 13.8, w: 28, d: 2.4, r: 0.8 };
  const cabeza = ejeZ(c.x + 26, c.y + 15, zt + 2.6);
  put("carro.llave", [c.x + 38, c.y + 15, zt + 3.4], S(k.slabOf(mango, zt + 2.6, 1.6, P, 2), { tone: "hi", crease: "lo" }) + S(G.solidOf([[0, 2.8], [2.2, 2.8]], cabeza, P), { tone: "hi", crease: "lo" }),
    [R.solid(A.slab(mango, zt + 2.6, 1.6, { name: "carro.llave", owner: "carro" }, 2)), R.solid(A.solid(cabeza, [[0, 2.8], [2.2, 2.8]], { name: "carro.llave.cabeza", owner: "carro" }))]);
}

// Recolector de aceite: el embudo bajo el cárter, el caño telescópico y el tanque.
function recolector() {
  const x = 92;
  const y = 14;
  const zt = 13;
  fondo.push(`<path class="iso-halo" d="${k.haloOf({ x: x - 16, y: y - 16, w: 32, d: 32, r: 16 }, 0, 4, P)}"/>`);
  const pies = [[-12, -10], [12, -10], [-12, 10], [12, 10]].map(([u, v]) => [x + u, y + v]);
  for (const [u, v] of porFondo(pies)) {
    torneado(`recolector.rueda${u}${v}`, ejeZ(u, v, 0), [[0, 2.6], [5, 2.6]], { tone: "lo" }, { owner: "recolector" });
  }
  const F = ejeZ(x, y, 5);
  torneado("recolector.tanque", F, [[0, 15], [1.4, 15.6], [zt, 15.6], [zt + 1.6, 13], [zt + 3, 6], [zt + 6, 4]], { tone: "mid" }, {
    owner: "recolector",
    inner: Ln(G.arcOf(F, 5, 15.6, P) + G.arcOf(F, zt - 1, 15.6, P), { tone: "faint" }),
  });
  torneado("recolector.cano", ejeZ(x, y, 5 + zt + 6), [[0, 2.6], [8, 2.6], [8, 1.7], [24, 1.7]], { tone: "lo" }, { owner: "recolector" });
  const zf = 5 + zt + 6 + 24;
  const FF = ejeZ(x, y, zf);
  torneado("recolector.embudo", FF, [[0, 1.7], [2, 2.6], [11, 12.6], [13, 13]], { tone: "hi", crease: "lo" }, {
    owner: "recolector",
    extra: `<path class="cavo" d="${G.circleOf(FF, 13, 11.4, P)}"/>` + Ln(G.circleOf(FF, 13, 11.4, P), { tone: "mid" }),
  });
}

// La rueda sacada, acostada en el piso junto a la esquina que le falta.
function ruedaSuelta() {
  const x = 104;
  const y = 72;
  fondo.push(`<path class="iso-halo" d="${k.haloOf({ x: x - 16, y: y - 16, w: 32, d: 32, r: 16 }, 0, 6, P)}"/>`);
  rueda("suelta", G.frameOf([x, y, RUEDA_ANCHO / 2], [0, 0, 1], [1, 0, 0], [0, 1, 0]), { owner: "suelta" });
  // Los cinco bulones, juntos en una bandeja.
  const b = { x: 130, y: 76, w: 20, d: 13, r: 1.4 };
  caja("suelta.bandeja", [b.x, b.y, 0], [b.x + b.w, b.y + b.d, 1.6], { tone: "lo" }, { r: 1.4, steps: 3, extra: Ln(k.planOutline(k.insetPlan(b, 1.6), 1.6, P, 2), { tone: "faint" }) });
  porFondo([[135, 80], [140, 79.6], [145, 80.6], [137.4, 85], [143, 85]]).forEach(([u, v]) => {
    torneado(`suelta.bulon${u}`, ejeZ(u, v, 1.6), [[0, 1.5], [1.2, 1.5], [1.2, 0.9], [3.4, 0.9]], { tone: "hi", crease: "lo" }, { owner: "suelta" });
  });
}

function gato() {
  const x = -46;
  const y = 95;
  const chasis = { x: x - 20, y: y - 7, w: 40, d: 14, r: 1 };
  fondo.push(`<path class="iso-halo" d="${k.haloOf(chasis, 0, 3, P)}"/>`);
  for (const [u, s0, r] of [[x + 13, y + 7, 4], [x - 13, y + 7, 3]]) {
    const F = ejeY(u, s0, r);
    torneado(`gato.rueda${u}`, F, [[0, r], [2.6, r]], { tone: "lo" }, { owner: "gato", extra: Dots([at([u, s0 + 2.6, r])], { size: 0.5 }) });
  }
  caja("gato.chasis", [chasis.x, chasis.y, 1.5], [chasis.x + chasis.w, chasis.y + chasis.d, 9], { tone: "mid" }, {
    owner: "gato", bevel: 0.5, inner: Ln(k.sideSeam(chasis, 4, P, 2), { tone: "faint" }),
    extra: Ln(k.planOutline(k.insetPlan(chasis, 2), 9, P, 2), { tone: "lo" }),
  });
  // Bomba, brazo inclinado y platillo.
  const FB = ejeZ(x - 12, y, 9);
  torneado("gato.bomba", FB, [[0, 3.4], [7, 3.4], [7, 2.2], [9.4, 2.2]], { tone: "hi", crease: "lo" }, { owner: "gato", extra: Ln(k.ring(x - 12, y, 1.1, 18.4, P, 12), { tone: "lo" }) });
  const giro = G.frameOf([x + 2, y, 9], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  const brazo = [[0, 0], [4, 0], [19, 10], [19, 14], [15, 14]];
  put("gato.brazo", [x + 10, y, 15], S(G.prismOf(giro, brazo, -4, 4, P), { tone: "hi", crease: "lo" }), [R.solid(A.prism(giro, brazo, -4, 4, { name: "gato.brazo", owner: "gato" }))]);
  const FS = ejeZ(x + 19, y, 23);
  torneado("gato.platillo", FS, [[0, 3], [1.4, 3], [1.4, 5.2], [2.8, 5.2]], { tone: "hi", crease: "lo" }, { owner: "gato", extra: Ln(k.ring(x + 19, y, 3.2, 25.8, P, 16), { tone: "lo" }) });
  // Palanca larga con su mango, que apoya en el chasis y sube hacia atrás.
  const raiz = [x - 20, y, 6];
  const dirP = G.unit3([-14, 0, 30]);
  const FP = G.frameOf(raiz, dirP, [0, 1, 0], G.unit3([30, 0, 14]));
  torneado("gato.palanca", FP, [[0, 1.3], [24, 1.3], [24, 1.9], [32, 1.9]], { tone: "mid" }, { owner: "gato" });
}

// ── Armado ─────────────────────────────────────────────────────────────────
piso();
poste("poste.fondo", -POSTE_Y, false);
poste("poste.frente", POSTE_Y, true);
travesano();
coche();
carroHerramientas();
recolector();
ruedaSuelta();
gato();

A.settle(R, P);
R.items.sort((a, b) => a.key - b.key);

// La escala del kit teñida apenas de azul: monocromo con la temperatura del producto.
// La jerarquía sale del tono y del único acento encendido, no del color.
const TINTE = `
.iso[data-theme="dark"]{
  --anatomy-paper:#10151c;--anatomy-face:#1a2230;--anatomy-top:#222b38;
  --anatomy-shade-0:#0b0f15;--anatomy-shade-1:#10151c;--anatomy-shade-2:#151b24;--anatomy-shade-3:#1a212b;
  --anatomy-lit-top:#3a4656;--anatomy-lit-shade:#2a3340;
  --anatomy-hi:#d6dfea;--anatomy-mid:#76869a;--anatomy-lo:#465364;--anatomy-faint:#2d3744;
  --anatomy-lit:#ffffff;--anatomy-halo:#020304;--anatomy-halo-opacity:.9;--anatomy-dot:#e6edf5;
}
.cavo{fill:#05070a;stroke:none}
.vidrio{fill:#0a0e14;stroke:none}
.reflejo{fill:#141a23;stroke:none}
.faro{fill:#2c3644;stroke:none}
.patente{fill:#27303c;stroke:none}`;

const svg = k.figureSvg({
  width: ANCHO,
  height: ALTO,
  label: "Sedán levantado en un elevador de dos postes, con la rueda delantera desmontada y el freno a la vista",
  body: [...fondo, ...R.items.map((i) => i.svg)],
  standalone: "dark",
}).replace("</style>", `${TINTE}</style>`);

writeFileSync(SALIDA, svg, "utf8");
console.log(`taller-iso.svg: ${R.solids.length} sólidos, ${R.items.length} ítems, ${(svg.match(/<path/g) || []).length} trazos, ${(svg.length / 1024).toFixed(0)} KB`);
A.auditOrExit(R, P, {});
