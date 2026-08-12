-- =============================================================
-- SassTaller — migracion 002: de "motos" a "vehiculos"
--
-- El sistema nacio para un taller de motos, pero el modelo de datos nunca tuvo
-- nada exclusivo de motos: marca, modelo, placa, numero de chasis (que en un auto
-- es el VIN), kilometraje. Lo unico atado a motos era el vocabulario.
--
-- Esta migracion abre el producto a cualquier taller:
--   · la tabla pasa a llamarse vehiculos (y moto_id -> vehiculo_id),
--   · cada vehiculo declara su tipo,
--   · los campos propios de cada tipo viven en JSON, para que sumar un tipo
--     nuevo mas adelante no requiera tocar el esquema,
--   · cada taller declara que tipos atiende.
-- =============================================================

-- 1) Renombrar la tabla. MySQL actualiza solas las claves foraneas que la apuntan.
RENAME TABLE motos TO vehiculos;

-- 2) Las columnas que la referencian. RENAME COLUMN mantiene la FK.
ALTER TABLE citas            RENAME COLUMN moto_id TO vehiculo_id;
ALTER TABLE ordenes_trabajo  RENAME COLUMN moto_id TO vehiculo_id;

-- 3) Indices: el nombre no afecta el funcionamiento, pero un indice llamado
--    uq_motos_tenant sobre una tabla vehiculos confunde a quien lo lea despues.
ALTER TABLE vehiculos RENAME INDEX idx_motos_tenant TO idx_vehiculos_tenant;
ALTER TABLE vehiculos RENAME INDEX uq_motos_tenant  TO uq_vehiculos_tenant;

-- 4) Tipo de vehiculo. Se agrega con DEFAULT para rellenar lo existente (todo lo
--    que hay hoy son motos) y despues se le quita: un vehiculo sin tipo declarado
--    quedaria registrado como moto en un taller de autos, en silencio.
ALTER TABLE vehiculos ADD COLUMN tipo VARCHAR(20) NOT NULL DEFAULT 'moto' AFTER cliente_id;
ALTER TABLE vehiculos ALTER COLUMN tipo DROP DEFAULT;
ALTER TABLE vehiculos ADD INDEX idx_vehiculos_tipo (tenant_id, tipo);

-- 5) Campos propios de cada tipo (cilindrada de una moto, ejes de un camion).
--    Van en JSON y no en columnas: con columnas, cada tipo nuevo seria una
--    migracion, y la tabla acumularia columnas vacias para todos los demas tipos.
--    No se indexan porque son datos de ficha, no criterios de busqueda.
ALTER TABLE vehiculos ADD COLUMN atributos JSON NULL
  COMMENT 'Campos propios del tipo (ver utils/tipos-vehiculo.js)';

-- 6) Que tipos atiende cada taller. Lo elige al darse de alta y define que
--    formularios ve y que catalogo de servicios recibe.
ALTER TABLE configuracion ADD COLUMN tipos_vehiculo JSON NULL
  COMMENT 'Tipos que atiende el taller, ej. ["moto","auto"]';

-- El taller original solo atiende motos.
UPDATE configuracion SET tipos_vehiculo = JSON_ARRAY('moto') WHERE tipos_vehiculo IS NULL;
