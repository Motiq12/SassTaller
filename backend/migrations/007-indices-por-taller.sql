-- =============================================================
-- Motiq — migracion 007: los indices arrancan por el taller
--
-- Toda consulta del sistema lleva `tenant_id = ?` (lo obliga el guard de
-- src/db/tenant-db.js). Siete indices arrancaban por otra columna —la fecha de la
-- cita, el nombre del cliente, la metrica— asi que MySQL entraba por ahi y
-- descartaba despues las filas de los demas talleres. Con dos clientes no se nota;
-- con doscientos, cada taller paga el costo de leer la agenda de todos.
--
-- El nuevo se crea ANTES de borrar el viejo, siempre. Los dos ultimos (`moto_id`,
-- que quedo con el nombre viejo tras el renombre motos -> vehiculos) respaldan una
-- clave foranea: si se borran primero, InnoDB rechaza el DROP.
--
-- Idempotente via auto-migrate. Este archivo queda como registro legible; el
-- servidor lo aplica solo al arrancar.
-- =============================================================

CREATE INDEX idx_citas_tenant_fecha     ON citas (tenant_id, fecha, hora);
DROP INDEX idx_citas_fecha_hora         ON citas;

CREATE INDEX idx_clientes_tenant_nombre ON clientes (tenant_id, activo, nombre, apellido);
DROP INDEX idx_clientes_activo_nombre   ON clientes;

CREATE INDEX idx_msg_tenant_broadcast   ON mensajes_internos (tenant_id, tipo, destino_rol, created_at);
DROP INDEX idx_msg_broadcast            ON mensajes_internos;

CREATE INDEX idx_msg_tenant_sucursal    ON mensajes_internos (tenant_id, sucursal_id);
DROP INDEX idx_msg_sucursal             ON mensajes_internos;

CREATE INDEX idx_ml_tenant_usuario      ON mensaje_lecturas (tenant_id, usuario_id);
DROP INDEX idx_ml_usuario               ON mensaje_lecturas;

CREATE INDEX idx_wv_tenant_metrica      ON web_vitals (tenant_id, metrica, created_at);
DROP INDEX idx_wv_metrica               ON web_vitals;

CREATE INDEX idx_wv_tenant_ruta         ON web_vitals (tenant_id, ruta);
DROP INDEX idx_wv_ruta                  ON web_vitals;

-- Renombre motos -> vehiculos: el indice conservo el nombre viejo. Respalda una FK.
CREATE INDEX idx_citas_vehiculo         ON citas (vehiculo_id);
DROP INDEX moto_id                      ON citas;

CREATE INDEX idx_ordenes_vehiculo       ON ordenes_trabajo (vehiculo_id);
DROP INDEX moto_id                      ON ordenes_trabajo;

-- Claves foraneas duplicadas: dos constraints sobre la misma columna (el de nombre
-- automatico y otro con nombre propio de una migracion posterior). InnoDB comprueba
-- las dos en cada alta y cada cambio de cita.
ALTER TABLE citas DROP FOREIGN KEY citas_ibfk_4;   -- tecnico_id (queda fk_citas_tecnico)
ALTER TABLE citas DROP FOREIGN KEY citas_ibfk_5;   -- sucursal_id (queda fk_citas_sucursal)
