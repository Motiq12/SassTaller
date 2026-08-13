-- =============================================================
-- Motiq — migracion 010: avisos de la plataforma hacia los talleres
--
-- Cuando Motiq hace mantenimiento, saca una funcion nueva o necesita avisar
-- cualquier cosa, esto le llega al personal de TODOS los talleres como una
-- franja arriba de su pantalla, sin tener que escribirle a cada uno aparte.
--
-- NO es mensajes_internos: esa tabla es de un taller hacia su propia gente y
-- va scopeada por tenant_id. Esta es deliberadamente GLOBAL — sin tenant_id —
-- porque la escribe Motiq y la lee cualquier taller.
-- =============================================================

CREATE TABLE IF NOT EXISTS avisos_plataforma (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  mensaje     VARCHAR(500) NOT NULL,
  tipo        ENUM('info','mantenimiento','urgente') NOT NULL DEFAULT 'info',
  activo      TINYINT(1) NOT NULL DEFAULT 1,
  admin_id    INT NULL,
  admin_email VARCHAR(150) NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_avisos_activo (activo, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
