// El disco de freno del hero, en 3D y en vivo.
//
// Todo se modela por código —pista flotante perforada y mecanizada, araña central
// con ventanas, botones flotantes y un caliper carmesí— para no depender de un
// archivo .glb ni de créditos de generación. Three.js entra con import() dinámico:
// queda en su propio archivo y solo lo baja quien abre la landing.
//
// La dirección es la de una foto de producto de estudio: fondo negro, acero que
// refleja un estudio en penumbra, una luz principal desde arriba a la izquierda y
// un contraluz carmesí que dibuja el canto del disco. El único color sólido es el
// caliper: el carmesí de la marca.
//
// Es un módulo sin Angular a propósito: recibe un <canvas> y devuelve con qué
// moverlo y cómo soltarlo. El componente decide cuándo (visible, pestaña activa,
// movimiento reducido).

export interface Encuadre {
  /** Centro del disco en fracciones del canvas (0..1). */
  cx: number;
  cy: number;
  /** Diámetro del disco en píxeles CSS. */
  diametro: number;
}

export interface Disco {
  /** Avance del scroll del hero, 0..1: el disco gira media vuelta. */
  scroll(p: number): void;
  /** Puntero normalizado -1..1 (o 0,0 para soltarlo). */
  puntero(x: number, y: number): void;
  encuadrar(e: Encuadre): void;
  /** Dibuja un cuadro. Devuelve false si ya no hay nada que animar. */
  cuadro(t: number): boolean;
  destruir(): void;
}

type Three = typeof import('three');

/**
 * Textura de mecanizado: surcos concéntricos finos, como deja el torno en la pista
 * de un disco. Se usa como mapa de rugosidad, así el brillo se quiebra en anillos
 * en vez de ser un espejo liso (lo que hacía que el disco pareciera de plástico).
 */
function texturaMecanizado(THREE: Three): import('three').CanvasTexture {
  const lado = 1024;
  const lienzo = document.createElement('canvas');
  lienzo.width = lienzo.height = lado;
  const ctx = lienzo.getContext('2d')!;
  ctx.fillStyle = 'rgb(70,70,70)';
  ctx.fillRect(0, 0, lado, lado);
  const c = lado / 2;
  // Un surco cada ~1,5 px de radio, con brillo al azar: el patrón no se repite.
  for (let r = lado * 0.28; r < c; r += 1.5) {
    const g = 45 + Math.floor(Math.random() * 60);
    ctx.strokeStyle = `rgb(${g},${g},${g})`;
    ctx.lineWidth = 1 + Math.random();
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(lienzo);
  // Las tapas de ExtrudeGeometry usan la posición (x, y) como UV, de -1 a 1:
  // se lleva a 0..1 para que el centro de la textura caiga en el eje del disco.
  tex.repeat.set(0.5, 0.5);
  tex.offset.set(0.5, 0.5);
  tex.anisotropy = 8;
  return tex;
}

export async function montarDisco(canvas: HTMLCanvasElement, opciones: { reducido: boolean }): Promise<Disco | null> {
  const THREE = await import('three');
  const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js');

  let renderer: import('three').WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return null;   // sin WebGL: el componente deja el disco plano de CSS
  }
  const movil = window.matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, movil ? 1.5 : 2));
  // Neutral y no ACES: ACES desatura los rojos y el carmesí de marca salía rosado.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;

  const escena = new THREE.Scene();
  // Reflejos metálicos sin bajar ningún HDR: un cuarto de estudio generado, bajado
  // de intensidad para que el acero refleje penumbra y no un cuarto blanco.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const entorno = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  escena.environment = entorno;
  escena.environmentIntensity = 0.5;

  const camara = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  const DIST = 6;
  camara.position.set(0, 0, DIST);

  const clave = new THREE.DirectionalLight(0xffffff, 1.9);
  clave.position.set(-4, 5, 6);
  const relleno = new THREE.DirectionalLight(0xdfe6ff, 0.5);
  relleno.position.set(3, -3, 4);
  // El contraluz carmesí: pinta el canto y los bordes de las perforaciones.
  const contra = new THREE.DirectionalLight(0xff2a55, 5);
  contra.position.set(5, 3, -5);
  escena.add(clave, relleno, contra);

  const desechables: { dispose(): void }[] = [entorno, pmrem];
  const seg = 128;

  // --- La pista de frenado ------------------------------------------------------
  const R_EXT = 1, R_INT = 0.64;
  const pista = new THREE.Shape();
  pista.absarc(0, 0, R_EXT, 0, Math.PI * 2, false);
  const hueco = new THREE.Path();
  hueco.absarc(0, 0, R_INT, 0, Math.PI * 2, true);
  pista.holes.push(hueco);
  // Perforaciones en grupos de tres, sobre una diagonal que cruza la pista: el
  // dibujo de los discos de moto actuales.
  const GRUPOS = 22;
  for (let g = 0; g < GRUPOS; g++) {
    for (let k = 0; k < 3; k++) {
      const r = 0.72 + k * 0.09;
      const a = (g / GRUPOS) * Math.PI * 2 + k * 0.07;
      const p = new THREE.Path();
      p.absarc(Math.cos(a) * r, Math.sin(a) * r, 0.026, 0, Math.PI * 2, true);
      pista.holes.push(p);
    }
  }
  // Sin bisel: el bisel en el borde de cada agujero agarraba la luz y los hacía
  // ver como tachuelas en relieve. Con el corte recto se leen como lo que son.
  const geoPista = new THREE.ExtrudeGeometry(pista, { depth: 0.045, bevelEnabled: false, curveSegments: seg });
  geoPista.translate(0, 0, -0.0225);
  const mecanizado = texturaMecanizado(THREE);
  const acero = new THREE.MeshPhysicalMaterial({
    color: 0xa7abb3, metalness: 1, roughness: 1, roughnessMap: mecanizado,
    clearcoat: 0.15, clearcoatRoughness: 0.3,
  });

  // --- La araña central: negra, de seis rayos -----------------------------------
  // Las ventanas son sectores de anillo: quedan seis rayos rectos entre el cubo y
  // el aro, como en la araña de un disco flotante.
  const arana = new THREE.Shape();
  arana.absarc(0, 0, 0.6, 0, Math.PI * 2, false);
  const eje = new THREE.Path();
  eje.absarc(0, 0, 0.12, 0, Math.PI * 2, true);
  arana.holes.push(eje);
  const RV_EXT = 0.52, RV_INT = 0.3, ABRE = THREE.MathUtils.degToRad(40);
  for (let i = 0; i < 6; i++) {
    const c = (i / 6) * Math.PI * 2;
    const ini = c - ABRE / 2, fin = c + ABRE / 2;
    const v = new THREE.Path();
    v.absarc(0, 0, RV_EXT, ini, fin, false);
    v.absarc(0, 0, RV_INT, fin, ini, true);
    arana.holes.push(v);
  }
  for (let i = 0; i < 6; i++) {                       // los tornillos a la rueda, en los rayos
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const h = new THREE.Path();
    h.absarc(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.022, 0, Math.PI * 2, true);
    arana.holes.push(h);
  }
  const geoArana = new THREE.ExtrudeGeometry(arana, {
    depth: 0.06, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 3, curveSegments: seg,
  });
  geoArana.translate(0, 0, -0.03);
  const anodizado = new THREE.MeshPhysicalMaterial({
    color: 0x141417, metalness: 0.7, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.25,
  });

  // --- Botones flotantes: unen la pista a la araña -----------------------------
  const geoBoton = new THREE.CylinderGeometry(0.03, 0.03, 0.075, 32);
  geoBoton.rotateX(Math.PI / 2);
  const brillo = new THREE.MeshStandardMaterial({ color: 0xe4e4e7, metalness: 1, roughness: 0.2 });

  const rotor = new THREE.Group();
  rotor.add(new THREE.Mesh(geoPista, acero), new THREE.Mesh(geoArana, anodizado));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const b = new THREE.Mesh(geoBoton, brillo);
    b.position.set(Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0);
    rotor.add(b);
  }

  // --- El caliper: carmesí brillante, fijo (el disco gira dentro de él) ---------
  // Abajo a la izquierda, del lado del titular: es lo primero que el ojo cruza
  // después del texto y el único color sólido del objeto.
  const a0 = THREE.MathUtils.degToRad(210), a1 = THREE.MathUtils.degToRad(252);
  const pinza = new THREE.Shape();
  pinza.absarc(0, 0, 1.08, a0, a1, false);
  pinza.absarc(0, 0, 0.74, a1, a0, true);
  const geoPinza = new THREE.ExtrudeGeometry(pinza, {
    depth: 0.3, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 6, curveSegments: 64,
  });
  // Centrado en profundidad: abraza el disco por las dos caras.
  geoPinza.translate(0, 0, -0.15);
  const pintura = new THREE.MeshPhysicalMaterial({
    color: 0xc8143c, metalness: 0.3, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06,
  });
  const caliper = new THREE.Group();
  caliper.add(new THREE.Mesh(geoPinza, pintura));

  // Los dos tornillos de anclaje, en la cara del caliper.
  const geoTornillo = new THREE.CylinderGeometry(0.05, 0.05, 0.04, 6);   // cabeza hexagonal
  geoTornillo.rotateX(Math.PI / 2);
  const caraZ = 0.15 + 0.06;
  for (const ang of [a0 + 0.1, a1 - 0.1]) {
    const t = new THREE.Mesh(geoTornillo, brillo);
    t.position.set(Math.cos(ang) * 0.82, Math.sin(ang) * 0.82, caraZ + 0.02);
    caliper.add(t);
  }

  // "MOTIQ" en el caliper, como las letras de un caliper de serie.
  const medio = (a0 + a1) / 2;
  const lienzo = document.createElement('canvas');
  lienzo.width = 512; lienzo.height = 128;
  const ctx = lienzo.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 96px Outfit, "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('MOTIQ', 256, 68);
    const tex = new THREE.CanvasTexture(lienzo);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const geoRotulo = new THREE.PlaneGeometry(0.34, 0.085);
    const matRotulo = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const rotulo = new THREE.Mesh(geoRotulo, matRotulo);
    rotulo.position.set(Math.cos(medio) * 0.9, Math.sin(medio) * 0.9, caraZ + 0.002);
    rotulo.rotation.z = medio + Math.PI / 2;   // a lo largo del arco, legible de izquierda a derecha
    caliper.add(rotulo);
    desechables.push(tex, geoRotulo, matRotulo);
  }

  const conjunto = new THREE.Group();
  conjunto.add(rotor, caliper);
  escena.add(conjunto);
  desechables.push(geoPista, mecanizado, acero, geoArana, anodizado, geoBoton, brillo, geoPinza, pintura, geoTornillo);

  // --- Estado y movimiento -----------------------------------------------------
  const INCL_X = -0.3, INCL_Y = -0.55;   // pose de reposo: tres cuartos, mirando al titular
  let scrollP = 0;
  let px = 0, py = 0, tx = 0, ty = 0;
  let giro = 0;
  let ultimo = 0;
  // El giro solo sigue mientras hay algo que mirar: arranca al aparecer, se renueva
  // con cada scroll o movimiento del puntero y se apaga solo a los pocos segundos.
  // Con el giro apagado y el puntero quieto, cuadro() devuelve false y el
  // componente deja de pedir cuadros: el disco queda quieto y no gasta nada.
  const GIRO_ACTIVO_MS = 5000, GIRO_FRENADO_MS = 1500;
  let ultimaInteraccion = performance.now();

  function encuadrar(e: Encuadre) {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camara.aspect = w / h;
    camara.updateProjectionMatrix();
    // Cuántas unidades del mundo entran por píxel a la distancia del disco.
    const altoMundo = 2 * DIST * Math.tan(THREE.MathUtils.degToRad(camara.fov / 2));
    const porPx = altoMundo / h;
    conjunto.scale.setScalar((e.diametro * porPx) / 2);
    conjunto.position.set((e.cx - 0.5) * w * porPx, (0.5 - e.cy) * h * porPx, 0);
  }

  function cuadro(t: number): boolean {
    const dt = ultimo ? Math.min((t - ultimo) / 1000, 0.05) : 0;
    ultimo = t;
    // El puntero se sigue con inercia, nunca de golpe.
    px += (tx - px) * Math.min(1, dt * 3.5);
    py += (ty - py) * Math.min(1, dt * 3.5);
    const quieto = t - ultimaInteraccion - GIRO_ACTIVO_MS;
    const impulso = opciones.reducido ? 0 : Math.min(1, Math.max(0, 1 - quieto / GIRO_FRENADO_MS));
    giro += dt * 0.1 * impulso;                       // un giro lento, que frena solo
    rotor.rotation.z = -(giro + scrollP * Math.PI);
    conjunto.rotation.x = INCL_X + py * 0.12;
    conjunto.rotation.y = INCL_Y + px * 0.16;
    renderer.render(escena, camara);
    return impulso > 0 || Math.abs(tx - px) > 0.001 || Math.abs(ty - py) > 0.001;
  }

  return {
    scroll(p) { if (!opciones.reducido) { scrollP = p; ultimaInteraccion = performance.now(); } },
    puntero(x, y) { if (!opciones.reducido) { tx = x; ty = y; ultimaInteraccion = performance.now(); } },
    encuadrar,
    cuadro,
    destruir() {
      desechables.forEach((d) => d.dispose());
      renderer.dispose();
      escena.clear();
    },
  };
}
