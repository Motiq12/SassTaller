// Cliente HTTP de la API para los arreglos (setup) que no pasan por la UI:
// mismos endpoints que usa el frontend, con el token de staff o del portal.
export const URL_API = process.env.E2E_URL_API || 'http://127.0.0.1:3201';
export const URL_WEB = process.env.E2E_URL_WEB || 'http://127.0.0.1:4310';

export interface Respuesta {
  status: number;
  json: any;
  texto: string;
}

export interface OpcionesPedir {
  token?: string;
  body?: any;
  taller?: string;
}

export class Api {
  private base = `${URL_API}/api`;

  async pedir(metodo: string, ruta: string, op: OpcionesPedir = {}): Promise<Respuesta> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (op.token) headers.authorization = `Bearer ${op.token}`;
    if (op.taller) headers['x-taller'] = op.taller;
    const r = await fetch(this.base + ruta, {
      method: metodo,
      headers,
      body: op.body === undefined ? undefined : JSON.stringify(op.body),
    });
    const texto = await r.text();
    let json: any = null;
    try { json = JSON.parse(texto); } catch { /* respuesta no JSON */ }
    return { status: r.status, json, texto };
  }

  get(ruta: string, op?: OpcionesPedir) { return this.pedir('GET', ruta, op); }
  post(ruta: string, op?: OpcionesPedir) { return this.pedir('POST', ruta, op); }
  put(ruta: string, op?: OpcionesPedir) { return this.pedir('PUT', ruta, op); }
  patch(ruta: string, op?: OpcionesPedir) { return this.pedir('PATCH', ruta, op); }
  delete(ruta: string, op?: OpcionesPedir) { return this.pedir('DELETE', ruta, op); }
}
