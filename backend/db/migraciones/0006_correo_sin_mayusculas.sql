-- El login y la recuperación de contraseña comparan el correo con LOWER(email), así que
-- "Ana@Correo.com" y "ana@correo.com" son la misma cuenta. Estos índices mantienen esas
-- búsquedas rápidas: el índice único de usuarios (tenant_id, email) no sirve para ellas.
CREATE INDEX IF NOT EXISTS "idx_usuarios_email_lower" ON "usuarios" (LOWER("email"));
CREATE INDEX IF NOT EXISTS "idx_clientes_email_lower" ON "clientes" (LOWER("email"));
