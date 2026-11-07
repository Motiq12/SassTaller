// Catálogo de marcas y modelos de motos para el autocompletado del portal.
// No es exhaustivo ni una restricción: el cliente puede escribir una marca/modelo
// que no esté en la lista (el backend acepta cualquier texto). Solo asiste la carga.

export const MODELOS_POR_MARCA: Record<string, string[]> = {
  Honda: ['CB125F', 'CB190R', 'CB300F', 'CB500F', 'CB650R', 'CBR250R', 'CBR500R', 'CBR600RR', 'XR150L', 'XR190L', 'XRE300', 'Tornado XR250', 'CRF250', 'CRF300L', 'Navi', 'Dio', 'Elite', 'PCX 150', 'Wave 110', 'Cargo 150', 'Africa Twin'],
  Yamaha: ['YBR125', 'FZ16', 'FZ25', 'FZ-S', 'MT-03', 'MT-07', 'MT-09', 'MT-15', 'R3', 'R15', 'R6', 'XTZ125', 'XTZ150', 'XTZ250 Ténéré', 'Crypton', 'BWS', 'NMAX', 'Fascino'],
  Suzuki: ['GN125', 'GS125', 'GSX-R150', 'GSX-S150', 'GIXXER 150', 'GIXXER 250', 'V-Strom 250', 'V-Strom 650', 'DR650', 'Address', 'Burgman', 'Hayabusa'],
  Kawasaki: ['Ninja 300', 'Ninja 400', 'Ninja 650', 'Ninja ZX-6R', 'Z400', 'Z650', 'Z900', 'Versys 300', 'Versys 650', 'KLR650', 'KLX150', 'KLX230'],
  KTM: ['Duke 125', 'Duke 200', 'Duke 250', 'Duke 390', 'RC 200', 'RC 390', '390 Adventure', '250 Adventure', '790 Adventure', 'EXC 300', 'SX 250'],
  Bajaj: ['Pulsar NS125', 'Pulsar NS160', 'Pulsar NS200', 'Pulsar 180', 'Pulsar 200 NS', 'Pulsar RS200', 'Dominar 250', 'Dominar 400', 'Boxer CT100', 'Boxer 150', 'Avenger'],
  TVS: ['Apache RTR 160', 'Apache RTR 180', 'Apache RTR 200', 'Apache RR 310', 'Raider 125', 'Sport 100', 'Star City', 'Ntorq 125'],
  Hero: ['Hunk 150', 'Hunk 160R', 'Xpulse 200', 'Glamour', 'Splendor', 'Ignitor', 'Dash'],
  Benelli: ['TNT 15', 'TNT 135', 'TNT 300', '302S', 'Leoncino 250', 'Leoncino 500', 'TRK 251', 'TRK 502', 'Imperiale 400'],
  CFMoto: ['150NK', '250NK', '300NK', '400NK', '650NK', '250SR', '300SR', '450SR', '650MT', '700CL-X'],
  'Royal Enfield': ['Classic 350', 'Bullet 350', 'Meteor 350', 'Hunter 350', 'Himalayan', 'Continental GT 650', 'Interceptor 650'],
  BMW: ['G 310 R', 'G 310 GS', 'F 750 GS', 'F 850 GS', 'R 1250 GS', 'S 1000 RR', 'S 1000 R', 'G 650 GS'],
  Ducati: ['Monster', 'Scrambler', 'Panigale V2', 'Panigale V4', 'Multistrada V2', 'Multistrada V4', 'Diavel', 'Hypermotard'],
  'Harley-Davidson': ['Iron 883', 'Forty-Eight', 'Street 750', 'Sportster S', 'Fat Boy', 'Street Bob', 'Nightster', 'Pan America'],
  Triumph: ['Street Triple', 'Speed Triple', 'Trident 660', 'Tiger 660', 'Tiger 900', 'Bonneville', 'Scrambler 400 X', 'Speed 400'],
  Aprilia: ['RS 150', 'RS 660', 'RSV4', 'Tuono 660', 'Tuono V4', 'SR 150', 'SXR 160'],
  Husqvarna: ['Svartpilen 250', 'Svartpilen 401', 'Vitpilen 250', 'Vitpilen 401', 'Norden 901', '701 Enduro'],
  Vespa: ['Primavera 150', 'Sprint 150', 'GTS 300', 'SXL 150'],
  Kymco: ['Agility 125', 'Like 150', 'People 150', 'AK 550', 'Xtown 300'],
  SYM: ['Symphony 150', 'Jet 14', 'Cruisym 300', 'Fiddle 150'],
  Keeway: ['RKF 125', 'RKS 150', 'Superlight 200', 'K-Light 202', 'Vieste 300'],
  Zontes: ['125 U', '155 G1', '310 R', '310 T', '310 X', '350 GK'],
  Italika: ['FT125', 'FT150', 'FT180', 'DM150', 'RT200', 'Vitalia 150'],
  Vento: ['Rocketman', 'Nitrox', 'Crossmax', 'Screamer'],
  Sukida: ['SK125', 'SK150', 'SK200'],
};

// Lista de marcas ordenada alfabéticamente.
export const MARCAS_MOTO: string[] = Object.keys(MODELOS_POR_MARCA).sort((a, b) => a.localeCompare(b));

// Modelos de una marca (case-insensitive); [] si la marca no está en el catálogo.
export function modelosDeMarca(marca: string): string[] {
  const clave = Object.keys(MODELOS_POR_MARCA).find(
    (m) => m.toLowerCase() === (marca || '').trim().toLowerCase()
  );
  return clave ? MODELOS_POR_MARCA[clave] : [];
}
