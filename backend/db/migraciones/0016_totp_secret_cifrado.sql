-- QP3-07: los secretos TOTP se guardan cifrados (utils/totp-cifrado.js), con el formato
-- `v1:<iv>:<tag>:<cifrado>` en base64. Para un secreto de 32 caracteres base32 eso son
-- unos 90 caracteres, y la columna era varchar(64): el valor cifrado no entraba.
--
-- Aditiva: solo agranda el largo máximo. Los valores que ya están (en claro) no cambian
-- y el código viejo los sigue leyendo igual. En Postgres agrandar un varchar no reescribe
-- la tabla ni revalida filas: es un cambio de catálogo.
ALTER TABLE usuarios ALTER COLUMN totp_secret TYPE varchar(255);
ALTER TABLE plataforma_admins ALTER COLUMN totp_secret TYPE varchar(255);
