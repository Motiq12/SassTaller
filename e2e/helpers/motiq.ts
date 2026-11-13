// Arreglos de la API reutilizados por todos los flujos. Cada función habla con
// los mismos endpoints que el frontend, y las aserciones de base de datos se
// hacen con pg directo (helpers/db). Nada toca la lógica del backend.
import type { Api } from './api';
import { dormir, filas, una } from './db';
import type { Pool } from 'pg';

export const CLAVE = 'ClaveSegura123';

// Sello único por corrida: entra en slugs, correos y placas para que nada
// choque entre workers ni con corridas previas (la base es persistente).
export function sello(): string {
  return Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36).padStart(3, '0');
}

export function dormirSeg(seg: number): Promise<void> { return dormir(seg * 1000); }

// ── Taller ────────────────────────────────────────────────────────────────────
// El alta de taller tiene un tope propio no configurable (3 por minuto y 10 por
// hora por IP): si da 429 se reintenta con el retryAfter que responde.
export interface TallerCreado {
  token: string;
  usuario: any;
  tallerId: number;
  slug: string;
  nombre: string;
}

export async function crearTallerApi(
  api: Api,
  datos: { slug: string; email: string; nombre: string }
): Promise<TallerCreado> {
  const tope = Date.now() + 5 * 60_000;
  for (;;) {
    const r = await api.post('/onboarding', {
      body: {
        nombre: datos.nombre,
        slug: datos.slug,
        admin: { nombre: 'Dueño de Prueba', email: datos.email, password: CLAVE },
        tipos: ['auto'],
        telefono: '88881111',
        direccion: 'Liberia Centro',
        provincia: 'Guanacaste',
        canton: 'Liberia',
      },
    });
    if (r.status === 201) {
      const d = r.json.data;
      return { token: d.token, usuario: d.usuario, tallerId: d.taller.id, slug: d.taller.slug, nombre: d.taller.nombre };
    }
    if (r.status === 429 && Date.now() < tope) {
      const espera = Number(r.json?.retryAfter) || 12;
      await dormirSeg(Math.min(espera + 1, 65));
      continue;
    }
    throw new Error(`El alta del taller respondió ${r.status}: ${r.texto.slice(0, 300)}`);
  }
}

export async function sucursalDe(db: Pool, tenantId: number): Promise<number> {
  const s = await una(db, 'SELECT id FROM sucursales WHERE tenant_id = ? ORDER BY activa DESC, id LIMIT 1', [tenantId]);
  if (!s) throw new Error('El taller no tiene sucursal sembrada');
  return s.id;
}

// ── Personal ─────────────────────────────────────────────────────────────────
export async function loginStaff(api: Api, email: string, password = CLAVE): Promise<{ token: string; usuario: any }> {
  const r = await api.post('/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`login de ${email} respondió ${r.status}: ${r.texto.slice(0, 200)}`);
  return { token: r.json.data.token, usuario: r.json.data.usuario || r.json.data.cliente };
}

export async function crearStaff(
  api: Api,
  token: string,
  datos: { rol: string; nombre: string; email: string; sucursalId: number }
): Promise<{ id: number; token: string; usuario: any; email: string }> {
  const r = await api.post('/usuarios', {
    token,
    body: {
      nombre: datos.nombre,
      email: datos.email,
      password: CLAVE,
      rol: datos.rol,
      sucursal_id: datos.sucursalId,
      telefono: '88880000',
    },
  });
  if (r.status >= 300) throw new Error(`alta de usuario respondió ${r.status}: ${r.texto.slice(0, 200)}`);
  const id = r.json.data.id || r.json.data.insertId;
  const sesion = await loginStaff(api, datos.email);
  return { id, email: datos.email, ...sesion };
}

// ── Clientes y vehículos ─────────────────────────────────────────────────────
export async function crearCliente(
  api: Api,
  token: string,
  datos: { nombre: string; apellido: string; email?: string; cedula?: string; telefono?: string }
): Promise<number> {
  const r = await api.post('/clientes', {
    token,
    body: {
      nombre: datos.nombre,
      apellido: datos.apellido,
      telefono: datos.telefono || '87654321',
      email: datos.email,
      cedula: datos.cedula || '115670890',
      tipo_cedula: 'fisica',
    },
  });
  if (r.status >= 300) throw new Error(`alta de cliente respondió ${r.status}: ${r.texto.slice(0, 200)}`);
  return r.json.data.id || r.json.data.insertId;
}

export async function crearVehiculo(
  api: Api,
  token: string,
  datos: { clienteId: number; placa: string; marca?: string; modelo?: string; anio?: number; color?: string; kilometraje?: number }
): Promise<number> {
  const r = await api.post('/vehiculos', {
    token,
    body: {
      cliente_id: datos.clienteId,
      placa: datos.placa,
      marca: datos.marca || 'Toyota',
      modelo: datos.modelo || 'Yaris',
      anio: datos.anio || 2022,
      tipo: 'auto',
      color: datos.color || 'Azul Metálico',
      kilometraje_actual: datos.kilometraje ?? 28500,
    },
  });
  if (r.status >= 300) throw new Error(`alta de vehículo respondió ${r.status}: ${r.texto.slice(0, 200)}`);
  return r.json.data.id;
}

export async function crearOrdenDeTaller(
  api: Api,
  token: string,
  db: Pool,
  taller: { tallerId: number },
  datos: { clienteId: number; vehiculoId: number; problema: string }
): Promise<{ id: number; numero: string }> {
  const sucursalId = await sucursalDe(db, taller.tallerId);
  const r = await api.post('/ordenes', {
    token,
    body: {
      cliente_id: datos.clienteId,
      vehiculo_id: datos.vehiculoId,
      moto_id: datos.vehiculoId,
      sucursal_id: sucursalId,
      problema_reportado: datos.problema,
      descripcion: datos.problema,
      tipo_servicio: 'Revisión general',
    },
  });
  if (r.status >= 300) throw new Error(`alta de orden respondió ${r.status}: ${r.texto.slice(0, 300)}`);
  return { id: r.json.data.id, numero: r.json.data.numero_orden || '' };
}

export async function asignarTecnico(api: Api, token: string, ordenId: number, tecnicoId: number): Promise<void> {
  const r = await api.patch(`/ordenes/${ordenId}/tecnico`, { token, body: { tecnico_id: tecnicoId } });
  if (r.status >= 300) throw new Error(`asignar técnico respondió ${r.status}: ${r.texto.slice(0, 200)}`);
}

export async function transicionar(api: Api, token: string, ordenId: number, estado: string): Promise<void> {
  const r = await api.patch(`/ordenes/${ordenId}/estado`, { token, body: { estado, confirmar: true } });
  if (r.status >= 300) throw new Error(`cambio a ${estado} respondió ${r.status}: ${r.texto.slice(0, 300)}`);
}

// ── Portal del cliente ───────────────────────────────────────────────────────
// El registro del portal exige confirmar el correo; el mailer corre en modo
// simulación (RESEND vacía), así que el flag se activa directo en la base.
// Única escritura directa de la suite, documentada: es el equivalente del
// cliente confirmando su código de 6 dígitos.
export async function registrarClientePortal(
  api: Api,
  db: Pool,
  slug: string,
  datos: { nombre: string; apellido: string; email: string; telefono?: string; cedula?: string }
): Promise<{ clienteId: number; email: string }> {
  const r = await api.post('/portal/registro', {
    taller: slug,
    body: {
      nombre: datos.nombre,
      apellido: datos.apellido,
      telefono: datos.telefono || '88884444',
      email: datos.email,
      cedula: datos.cedula || '109990888',
      password: CLAVE,
      taller: slug,
    },
  });
  if (r.status >= 300 && r.status !== 429) throw new Error(`registro del portal respondió ${r.status}: ${r.texto.slice(0, 300)}`);
  if (r.status === 429) {
    const espera = Number(r.json?.retryAfter) || 20;
    await dormirSeg(Math.min(espera + 1, 65));
    return registrarClientePortal(api, db, slug, datos);
  }
  const t = await una(db, 'SELECT id FROM tenants WHERE slug = ?', [slug]);
  await filas(db, 'UPDATE clientes SET email_verificado = 1 WHERE tenant_id = ? AND email = ?', [t.id, datos.email]);
  const c = await una(db, 'SELECT id FROM clientes WHERE tenant_id = ? AND email = ?', [t.id, datos.email]);
  return { clienteId: c.id, email: datos.email };
}

export async function loginClientePortal(
  api: Api,
  slug: string,
  email: string
): Promise<{ token: string; cliente: any }> {
  const r = await api.post('/portal/login', { taller: slug, body: { email, password: CLAVE, taller: slug } });
  if (r.status !== 200) throw new Error(`login del portal respondió ${r.status}: ${r.texto.slice(0, 300)}`);
  return { token: r.json.data.token, cliente: r.json.data.cliente };
}

// ── Cotización, aprobación y entrega ─────────────────────────────────────────
export interface Pieza { nombre: string; cantidad: number; costo_unitario: number }

export async function cotizar(
  api: Api,
  token: string,
  ordenId: number,
  piezas: Pieza[],
  manoObra: number
): Promise<{ total: number }> {
  const r = await api.post(`/recepcion/cotizaciones/${ordenId}/armar`, {
    token,
    body: { piezas, costo_mano_obra: manoObra },
  });
  if (r.status >= 300) throw new Error(`armar cotización respondió ${r.status}: ${r.texto.slice(0, 300)}`);
  const e = await api.post(`/recepcion/cotizaciones/${ordenId}/enviar`, { token, body: {} });
  if (e.status >= 300) throw new Error(`enviar cotización respondió ${e.status}: ${e.texto.slice(0, 300)}`);
  return { total: Number(r.json.data.total) };
}

export async function aprobarComoCliente(api: Api, tokenCliente: string, ordenId: number): Promise<void> {
  const r = await api.post(`/portal/ordenes/${ordenId}/aprobar`, { token: tokenCliente, body: {} });
  if (r.status >= 300) throw new Error(`aprobar respondió ${r.status}: ${r.texto.slice(0, 300)}`);
}

export async function rechazarComoCliente(api: Api, tokenCliente: string, ordenId: number, motivo: string): Promise<void> {
  const r = await api.post(`/portal/ordenes/${ordenId}/rechazar`, { token: tokenCliente, body: { motivo } });
  if (r.status >= 300) throw new Error(`rechazar respondió ${r.status}: ${r.texto.slice(0, 300)}`);
}

// Las piezas de la cotización nacen "pendiente": al aprobar, la orden pasa a
// esperando_repuestos. Esto marca cada pieza como recibida (botón "Llegó" del
// detalle, misma llamada) y deja la orden en reparación.
export async function repuestosEnTaller(api: Api, token: string, db: Pool, ordenId: number): Promise<void> {
  const piezas = await filas(db, 'SELECT id, nombre, cantidad, costo_unitario FROM orden_repuestos WHERE orden_id = ? AND rechazado = 0', [ordenId]);
  for (const p of piezas) {
    const r = await api.put(`/ordenes/${ordenId}/repuestos/${p.id}`, {
      token,
      body: { nombre: p.nombre, cantidad: p.cantidad, costo_unitario: Number(p.costo_unitario), estado: 'disponible' },
    });
    if (r.status >= 300) throw new Error(`marcar repuesto disponible respondió ${r.status}: ${r.texto.slice(0, 300)}`);
  }
  const o = await una(db, 'SELECT estado FROM ordenes_trabajo WHERE id = ?', [ordenId]);
  if (o.estado === 'esperando_repuestos') await transicionar(api, token, ordenId, 'en_reparacion');
}

// Camino completo hasta "lista para entrega", listo para el flujo 10 (entrega).
export async function ordenListaParaEntrega(
  api: Api,
  token: string,
  db: Pool,
  taller: { tallerId: number; slug: string },
  datos: {
    clienteId: number;
    vehiculoId: number;
    problema: string;
    piezas: Pieza[];
    manoObra: number;
    tokenCliente: string;
  }
): Promise<{ id: number; numero: string }> {
  const orden = await crearOrdenDeTaller(api, token, db, taller, datos);
  await cotizar(api, token, orden.id, datos.piezas, datos.manoObra);
  await aprobarComoCliente(api, datos.tokenCliente, orden.id);
  await repuestosEnTaller(api, token, db, orden.id);
  await transicionar(api, token, orden.id, 'lista_entrega');
  return orden;
}
