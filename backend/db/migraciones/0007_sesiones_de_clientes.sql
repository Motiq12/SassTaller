-- Para poder cerrar las sesiones de un cliente del portal (al cambiar o recuperar su
-- contraseña): los tokens firmados antes de ese momento dejan de valer. Es lo mismo que
-- ya tiene el personal en usuarios.sesiones_desde_ms. Vacío = nunca se cerraron.
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "sesiones_desde_ms" bigint DEFAULT NULL;
