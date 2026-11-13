// Fixture principal: cada worker de Playwright crea SU PROPIO taller por la API
// de onboarding (con reintento por el tope de 3 por minuto que no es
// configurable). Así ningún worker mezcla datos con otro, ni con corridas
// previas, aunque la base E2E sea persistente.
import { test as base } from '@playwright/test';
import { Api } from '../helpers/api';
import { abrirDb } from '../helpers/db';
import type { Pool } from 'pg';
import * as m from '../helpers/motiq';

export interface TallerCtx {
  api: Api;
  db: Pool;
  /** Token del admin dueño. */
  token: string;
  usuario: any;
  tallerId: number;
  slug: string;
  nombre: string;
  sello: string;
  sucursalId: number;
  adminEmail: string;
  adminPassword: string;
  /** Crea un usuario de staff (recepcion, tecnico...) y devuelve su sesión. */
  crearStaff(rol: 'recepcion' | 'tecnico' | 'solo_lectura', nombre: string): Promise<{ id: number; email: string; token: string; usuario: any }>;
  /** Crea un cliente por API y devuelve su id. */
  crearCliente(datos?: { nombre?: string; apellido?: string; email?: string }): Promise<number>;
  /** Crea un vehículo por API y devuelve su id. */
  crearVehiculo(clienteId: number, datos?: { placa?: string; marca?: string; modelo?: string }): Promise<number>;
  /** Crea una orden en recepción por API. */
  crearOrden(clienteId: number, vehiculoId: number, problema: string): Promise<{ id: number; numero: string }>;
  /** Registra un cliente del portal (con correo verificado) y devuelve su sesión. */
  crearClientePortal(nombre: string, apellido: string, email?: string): Promise<{ clienteId: number; email: string; token: string; cliente: any }>;
  /** Sufijo único dentro del worker: el taller lo comparten todos los specs que corren en él. */
  unico(): string;
}

export const test = base.extend<{}, { taller: TallerCtx }>({
  taller: [
    async ({ }, use, workerInfo) => {
      const api = new Api();
      const db = abrirDb();
      const s = m.sello() + 'w' + workerInfo.workerIndex;
      const slug = 't' + s.toLowerCase();
      const adminEmail = `${slug}@prueba.test`;

      const creado = await m.crearTallerApi(api, { slug, email: adminEmail, nombre: `Taller E2E ${slug}` });
      const sucursalId = await m.sucursalDe(db, creado.tallerId);

      // Varios specs corren en el mismo worker y comparten este taller: todo lo
      // que la base exige único por taller (correo del personal, placa, cuenta
      // del portal) lleva un contador propio para no chocar entre specs.
      let n = 0;
      const unico = () => `${s.slice(-4)}${(++n).toString(36)}`.toUpperCase();

      const ctx: TallerCtx = {
        api,
        db,
        token: creado.token,
        usuario: creado.usuario,
        tallerId: creado.tallerId,
        slug: creado.slug,
        nombre: creado.nombre,
        sello: slug,
        sucursalId,
        adminEmail,
        adminPassword: m.CLAVE,
        crearStaff: (rol, nombre) =>
          m.crearStaff(api, creado.token, {
            rol,
            nombre,
            email: `${rol}.${unico().toLowerCase()}.${slug}@prueba.test`,
            sucursalId,
          }),
        crearCliente: (datos = {}) =>
          m.crearCliente(api, creado.token, {
            nombre: datos.nombre || 'Mariana',
            apellido: datos.apellido || `Campos ${slug}`,
            email: datos.email || `mariana.${unico().toLowerCase()}.${slug}@prueba.test`,
          }),
        crearVehiculo: (clienteId, datos = {}) =>
          m.crearVehiculo(api, creado.token, {
            clienteId,
            placa: datos.placa || `E${unico()}`,
            marca: datos.marca || 'Toyota',
            modelo: datos.modelo || 'Yaris',
          }),
        crearOrden: (clienteId, vehiculoId, problema) =>
          m.crearOrdenDeTaller(api, creado.token, db, { tallerId: creado.tallerId }, { clienteId, vehiculoId, problema }),
        crearClientePortal: async (nombre, apellido, email) => {
          const correo = email || `${nombre.toLowerCase()}.${unico().toLowerCase()}.${slug}@prueba.test`;
          const c = await m.registrarClientePortal(api, db, creado.slug, { nombre, apellido, email: correo });
          const sesion = await m.loginClientePortal(api, creado.slug, correo);
          return { ...c, ...sesion };
        },
        unico,
      };

      await use(ctx);
      await db.end();
    },
    { scope: 'worker', timeout: 5 * 60_000 },
  ],
});
