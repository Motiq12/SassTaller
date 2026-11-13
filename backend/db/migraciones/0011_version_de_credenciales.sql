-- QA34-02: versión de credenciales del personal. Sube en cada cambio o recuperación de
-- contraseña y al desactivar la cuenta. El login la lee junto con el hash ANTES de
-- comprobar la contraseña y la deja en su sesión (y en el token); cada pedido compara
-- la de la sesión con la de la fila. Un login que validó la contraseña vieja y abrió su
-- sesión DESPUÉS del cambio queda con una versión vieja y no sirve.
-- Aditiva: las cuentas y sesiones actuales arrancan en 0 y siguen valiendo.
ALTER TABLE usuarios ADD COLUMN credenciales_version integer NOT NULL DEFAULT 0;
ALTER TABLE sesiones_personal ADD COLUMN credenciales_version integer NOT NULL DEFAULT 0;
