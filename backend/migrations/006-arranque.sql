-- =============================================================
-- Motiq — migracion 006: el primer dia de un taller
--
-- Un taller se registra y cae en un panel con todo en cero: sin clientes, sin
-- vehiculos, sin ordenes. El sistema esta completo y no hay nada que mirar, y ese
-- es justo el momento en que se decide si vuelve manana. Esto agrega las dos
-- piezas que faltaban para acompanar ese primer dia.
--
-- 1) es_ejemplo — datos de mentira que se cargan de un boton y se van de otro.
--    La marca va en la fila y no en una tabla aparte porque el borrado tiene que
--    ser exacto: "todo lo creado el primer dia" se llevaria por delante lo que el
--    taller ya cargo de verdad mientras probaba.
--
-- 2) arranque_oculto — si cerraron a mano el checklist de arranque. Es lo UNICO
--    que se guarda de el: los pasos se derivan de los datos (tiene logo?, hay mas
--    de un usuario?, hay alguna orden?), porque un progreso guardado aparte puede
--    terminar diciendo que algo esta hecho cuando ya no lo esta.
--
-- Idempotente via auto-migrate (addColumnIfMissing). Este archivo queda como
-- registro legible del cambio; el servidor lo aplica solo al arrancar.
-- =============================================================

ALTER TABLE clientes        ADD COLUMN es_ejemplo TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE vehiculos       ADD COLUMN es_ejemplo TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE ordenes_trabajo ADD COLUMN es_ejemplo TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE citas           ADD COLUMN es_ejemplo TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE configuracion   ADD COLUMN arranque_oculto TINYINT(1) NOT NULL DEFAULT 0;
