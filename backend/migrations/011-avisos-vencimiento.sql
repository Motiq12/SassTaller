-- =============================================================
-- Motiq — migracion 011: vencimiento automatico de un aviso
--
-- Antes un aviso quedaba activo hasta que alguien se acordara de apagarlo a
-- mano. Con vence_el se puede publicar "mantenimiento el domingo de 2am a
-- 4am" y que la franja deje de mostrarse sola pasada esa hora, sin depender
-- de que Motiq vuelva a entrar al panel a apagarla.
--
-- NULL = no vence solo (el comportamiento de antes: hay que apagarlo a mano).
-- =============================================================

ALTER TABLE avisos_plataforma ADD COLUMN vence_el DATETIME NULL AFTER activo;
