-- =============================================================
-- Motiq — migracion 004: administracion de la plataforma
--
-- Hasta ahora la tabla `tenants` existia pero nadie la administraba: para saber
-- quien se habia registrado habia que entrar a MySQL a mano. Esto agrega las
-- piezas para operar el negocio.
--
-- Los administradores de Motiq NO van en `usuarios`. Esa tabla es de personal de
-- un taller: tiene tenant_id NOT NULL y el guard exige filtrarla por taller en
-- cada consulta. Meter ahi a alguien "sin taller" obligaria a permitir tenant_id
-- nulo, que es exactamente la garantia que sostiene todo el aislamiento.
-- =============================================================

CREATE TABLE IF NOT EXISTS plataforma_admins (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  nombre        VARCHAR(120) NOT NULL,
  email         VARCHAR(150) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  activo        TINYINT(1) NOT NULL DEFAULT 1,
  ultimo_acceso DATETIME NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- Unico GLOBAL, no por taller: acá no hay talleres. Es la diferencia de fondo
  -- con usuarios, donde el mismo correo puede repetirse entre talleres.
  UNIQUE KEY uq_plataforma_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Motivo de la suspension: si un taller queda bloqueado, quien atienda el reclamo
-- tiene que poder decir por que sin adivinar.
ALTER TABLE tenants ADD COLUMN motivo_estado VARCHAR(200) NULL
  COMMENT 'Por que se suspendio o reactivo (lo escribe el admin de Motiq)';

-- Cuando vence el periodo de prueba. NULL = sin vencimiento (los que ya existian).
ALTER TABLE tenants ADD COLUMN trial_hasta DATE NULL;

-- Los talleres se listan y filtran por estado desde el panel.
ALTER TABLE tenants ADD INDEX idx_tenants_estado (estado);
