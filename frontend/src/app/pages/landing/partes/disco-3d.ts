// El disco de freno del hero, en 3D y en vivo.
//
// Todo se modela por código —disco flotante perforado, soporte con aligeramientos,
// remaches y un caliper carmesí— para no depender de un archivo .glb ni de
// créditos de generación. Three.js entra con import() dinámico: queda en su propio
// archivo y solo lo baja quien abre la landing.
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
  /** Avance del scroll del hero, 0..1: el disco gira una vuelta entera. */
  scroll(p: number): void;
  /** Puntero normalizado -1..1 (o 0,0 para soltarlo). */
  puntero(x: number, y: number): void;
  encuadrar(e: Encuadre): void;
  /** Dibuja un cuadro. Devuelve false si ya no hay nada que animar. */
  cuadro(t: number): boolean;
  destruir(): void;
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
  renderer.toneMappingExposure = 1;

  const escena = new THREE.Scene();
  // Reflejos metálicos sin bajar ningún HDR: un cuarto de estudio generado.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const entorno = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  escena.environment = entorno;

  const camara = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  const DIST = 6;
  camara.position.set(0, 0, DIST);

  const clave = new THREE.DirectionalLight(0xffffff, 2.4);
  clave.position.set(-3, 4, 5);
  const contra = new THREE.DirectionalLight(0xffe4e9, 1.1);
  contra.position.set(4, -2, -3);
  escena.add(clave, contra);

  const desechables: { dispose(): void }[] = [entorno, pmrem];
  const seg = 96;

  // --- El disco (pista de frenado) -------------------------------------------
  const anillo = new THREE.Shape();
  anillo.absarc(0, 0, 1, 0, Math.PI * 2, false);
  const centro = new THREE.Path();
  centro.absarc(0, 0, 0.56, 0, Math.PI * 2, true);
  anillo.holes.push(centro);
  // Tres hileras de perforaciones en espiral, como los discos de moto.
  const hileras = [0.66, 0.76, 0.86];
  hileras.forEach((r, fila) => {
    const n = 24;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + fila * 0.085;
      const agujero = new THREE.Path();
      agujero.absarc(Math.cos(a) * r, Math.sin(a) * r, 0.024, 0, Math.PI * 2, true);
      anillo.holes.push(agujero);
    }
  });
  const geoPista = new THREE.ExtrudeGeometry(anillo, {
    depth: 0.05, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: seg,
  });
  geoPista.center();
  const acero = new THREE.MeshPhysicalMaterial({ color: 0xd9dadc, metalness: 1, roughness: 0.32, clearcoat: 0.25 });

  // --- El soporte (la "araña" interior), más oscuro ---------------------------
  const soporte = new THREE.Shape();
  soporte.absarc(0, 0, 0.555, 0, Math.PI * 2, false);
  const eje = new THREE.Path();
  eje.absarc(0, 0, 0.13, 0, Math.PI * 2, true);
  soporte.holes.push(eje);
  for (let i = 0; i < 6; i++) {                      // aligeramientos
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const h = new THREE.Path();
    h.absarc(Math.cos(a) * 0.38, Math.sin(a) * 0.38, 0.085, 0, Math.PI * 2, true);
    soporte.holes.push(h);
  }
  for (let i = 0; i < 5; i++) {                      // los 5 tornillos a la rueda
    const a = (i / 5) * Math.PI * 2;
    const h = new THREE.Path();
    h.absarc(Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0.026, 0, Math.PI * 2, true);
    soporte.holes.push(h);
  }
  const geoSoporte = new THREE.ExtrudeGeometry(soporte, {
    depth: 0.07, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2, curveSegments: seg,
  });
  geoSoporte.center();
  const anodizado = new THREE.MeshPhysicalMaterial({ color: 0x26272b, metalness: 0.75, roughness: 0.38, clearcoat: 0.6 });

  // --- Remaches flotantes entre pista y soporte -------------------------------
  const geoRemache = new THREE.CylinderGeometry(0.034, 0.034, 0.1, 24);
  geoRemache.rotateX(Math.PI / 2);
  const brillo = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, metalness: 1, roughness: 0.18 });

  const rotor = new THREE.Group();
  rotor.add(new THREE.Mesh(geoPista, acero), new THREE.Mesh(geoSoporte, anodizado));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const m = new THREE.Mesh(geoRemache, brillo);
    m.position.set(Math.cos(a) * 0.558, Math.sin(a) * 0.558, 0);
    rotor.add(m);
  }

  // --- El caliper: grafito, fijo (el disco gira dentro de él) ------------------
  // Va ABAJO del disco: ahí se recorta contra el plato carmesí (grafito sobre
  // carmesí se lee; carmesí sobre carmesí no) y queda lejos de la barra de arriba.
  const pinza = new THREE.Shape();
  const a0 = THREE.MathUtils.degToRad(238), a1 = THREE.MathUtils.degToRad(296);
  pinza.absarc(0, 0, 1.075, a0, a1, false);
  pinza.absarc(0, 0, 0.74, a1, a0, true);
  const geoPinza = new THREE.ExtrudeGeometry(pinza, {
    depth: 0.3, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.035, bevelSegments: 4, curveSegments: 48,
  });
  // Solo se centra en profundidad: así abraza el disco por las dos caras y queda
  // exactamente sobre su borde (la forma ya está dibujada en su lugar).
  geoPinza.translate(0, 0, -0.15);
  const medio = (a0 + a1) / 2;
  const pintura = new THREE.MeshPhysicalMaterial({
    color: 0x1b1b1f, metalness: 0.55, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.2,
  });
  const caliper = new THREE.Mesh(geoPinza, pintura);

  // "MOTIQ" en el caliper, como las letras de un caliper de serie.
  const lienzo = document.createElement('canvas');
  lienzo.width = 512; lienzo.height = 128;
  const ctx = lienzo.getContext('2d');
  let rotulo: import('three').Mesh | null = null;
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 92px Outfit, "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('MOTIQ', 256, 68);
    const tex = new THREE.CanvasTexture(lienzo);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const geoRotulo = new THREE.PlaneGeometry(0.42, 0.105);
    const matRotulo = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    rotulo = new THREE.Mesh(geoRotulo, matRotulo);
    rotulo.position.set(Math.cos(medio) * 0.905, Math.sin(medio) * 0.905, 0.19);
    rotulo.rotation.z = medio + Math.PI / 2;   // abajo del disco: se lee de izquierda a derecha
    desechables.push(tex, geoRotulo, matRotulo);
  }

  const conjunto = new THREE.Group();
  conjunto.add(rotor, caliper);
  if (rotulo) conjunto.add(rotulo);
  escena.add(conjunto);
  desechables.push(geoPista, acero, geoSoporte, anodizado, geoRemache, brillo, geoPinza, pintura);

  // --- Estado y movimiento -----------------------------------------------------
  const INCL_X = -0.32, INCL_Y = -0.62;   // pose de reposo: el disco de tres cuartos
  let scrollP = 0;
  let px = 0, py = 0, tx = 0, ty = 0;
  let giro = 0;
  let ultimo = 0;

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
    px += (tx - px) * Math.min(1, dt * 4);
    py += (ty - py) * Math.min(1, dt * 4);
    if (!opciones.reducido) giro += dt * 0.12;       // un giro lento, casi en reposo
    rotor.rotation.z = -(giro + scrollP * Math.PI * 2);
    conjunto.rotation.x = INCL_X + py * 0.14;
    conjunto.rotation.y = INCL_Y + px * 0.2;
    renderer.render(escena, camara);
    return !opciones.reducido || Math.abs(tx - px) > 0.001 || Math.abs(ty - py) > 0.001;
  }

  return {
    scroll(p) { scrollP = opciones.reducido ? 0 : p; },
    puntero(x, y) { if (!opciones.reducido) { tx = x; ty = y; } },
    encuadrar,
    cuadro,
    destruir() {
      desechables.forEach((d) => d.dispose());
      renderer.dispose();
      escena.clear();
    },
  };
}
