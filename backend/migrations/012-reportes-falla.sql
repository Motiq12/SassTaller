-- =============================================================
-- Motiq — migracion 012: reportes de falla desde los talleres
--
-- Al reves de avisos_plataforma (Motiq -> talleres), esta va de un taller
-- hacia Motiq: cualquiera del personal (admin/recepcion/mecanico) puede
-- reportar que algo no funciona, y le llega al panel de la plataforma con
-- el taller, quien fue y cuando, sin pasar por WhatsApp.
--
-- tenant_id NO lleva clave foranea, mismo motivo que motiq_bitacora: si el
-- taller se da de baja, el reporte tiene que sobrevivir. Por eso se guarda
-- ademas una foto del nombre y el slug del taller en vez de depender de un
-- JOIN que dejaria de encontrar la fila.
-- =============================================================

CREATE TABLE IF NOT EXISTS reportes_falla (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id      INT NULL,
  tenant_nombre  VARCHAR(150) NULL,
  tenant_slug    VARCHAR(120) NULL,
  usuario_id     INT NULL,
  usuario_nombre VARCHAR(120) NULL,
  usuario_email  VARCHAR(150) NULL,
  usuario_rol    VARCHAR(20) NULL,
  descripcion    TEXT NOT NULL,
  pantalla       VARCHAR(200) NULL,
  estado         ENUM('nuevo','revisando','resuelto','descartado') NOT NULL DEFAULT 'nuevo',
  nota_interna   VARCHAR(500) NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_reportes_estado (estado, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
