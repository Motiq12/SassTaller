-- Se conserva el presupuesto aceptado y el detalle de cada adicional rechazado.
ALTER TABLE orden_repuestos ADD COLUMN rechazado smallint NOT NULL DEFAULT 0 CHECK (rechazado IN (0, 1));
ALTER TABLE ordenes_trabajo ADD COLUMN presupuesto_aprobado jsonb;
ALTER TABLE ordenes_trabajo ADD COLUMN adicionales_rechazados jsonb NOT NULL DEFAULT '[]'::jsonb;
-- Evidencia del cierre excepcional: actor, fecha, estado previo y motivo.
ALTER TABLE ordenes_trabajo ADD COLUMN cierre_excepcional jsonb;
-- La devolución conserva el canje para auditoría y se realiza una sola vez.
ALTER TABLE recompensas_canjeadas ADD COLUMN devuelta_en timestamptz;
