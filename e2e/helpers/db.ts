// Consultas directas a PostgreSQL para las aserciones de base de datos.
// Solo lectura (menos las excepciones documentadas: email_verificado del portal).
import { Pool, types } from 'pg';

types.setTypeParser(20, Number); // bigint (COUNT(*), ids grandes) como número

export const URL_DB =
  process.env.E2E_DATABASE_URL || 'postgres://motiq:motiq_dev@127.0.0.1:5433/motiq_t11_e2e';

export function abrirDb(): Pool {
  return new Pool({ connectionString: URL_DB, max: 3 });
}

// El backend usa placeholders `?` (estilo MySQL); pg usa $n. Misma traducción
// que hace el adaptador del backend, para poder copiar SQL de las rutas tal cual.
export async function filas(db: Pool, sql: string, params: any[] = []): Promise<any[]> {
  let n = 0;
  const r = await db.query(sql.replace(/\?/g, () => '$' + (++n)), params);
  return r.rows;
}

export async function una(db: Pool, sql: string, params: any[] = []): Promise<any> {
  return (await filas(db, sql, params))[0];
}

export function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
