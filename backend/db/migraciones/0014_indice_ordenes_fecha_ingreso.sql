-- B-14: los listados de órdenes de un taller filtran por tenant_id y ordenan por
-- fecha_ingreso DESC (ordenes.routes.js, el historial del vehículo, el panel y los
-- reportes). Solo había un índice por tenant_id, así que Postgres traía TODAS las
-- órdenes del taller y las ordenaba en memoria en cada pedido, aunque la pantalla
-- mostrara las primeras. Con el índice compuesto las lee ya en orden y corta en el LIMIT.
--
-- Aditiva: un índice nuevo, sin tocar datos ni columnas. Va sin CONCURRENTLY porque el
-- migrador corre cada archivo en una transacción; con el volumen actual la tabla queda
-- bloqueada para escritura apenas el tiempo de construirlo.
CREATE INDEX IF NOT EXISTS idx_ordenes_tenant_fecha_ingreso
  ON ordenes_trabajo (tenant_id, fecha_ingreso DESC);
