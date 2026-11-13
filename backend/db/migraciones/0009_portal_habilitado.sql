-- El acceso por correo sin contraseña ya existía: se conserva para las cuentas
-- actuales. Desde esta migración la desactivación es explícita e independiente
-- de las credenciales (Google, contraseña o código por correo).
ALTER TABLE clientes ADD COLUMN portal_habilitado smallint NOT NULL DEFAULT 1
  CHECK (portal_habilitado IN (0, 1));
-- Una versión evita la ambigüedad de iat (segundos) al revocar y volver a entrar.
ALTER TABLE clientes ADD COLUMN portal_version bigint NOT NULL DEFAULT 0;
