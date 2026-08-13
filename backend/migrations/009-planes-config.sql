-- =============================================================
-- Motiq — migracion 009: precio y limites de cada plan, editables
--
-- utils/limites.js sigue siendo la fuente de verdad de la FORMA de un plan (que
-- campos tiene, y el valor por defecto de cada uno si esta tabla no existe o esta
-- vacia). Esta tabla guarda los VALORES, para poder cambiar el precio del plan Pro
-- o subir el tope de usuarios del plan gratuito desde el panel, sin tocar codigo
-- ni redesplegar.
--
-- INSERT IGNORE en la semilla: solo pega la primera vez. Una instalacion donde
-- alguien ya edito el precio del plan Pro no puede volver a 0 cada vez que el
-- server reinicia.
-- =============================================================

CREATE TABLE IF NOT EXISTS planes_config (
  plan              VARCHAR(20) PRIMARY KEY,
  precio_mensual    INT NOT NULL DEFAULT 0,
  limite_usuarios   INT NULL,
  limite_sucursales INT NULL,
  marca_propia      TINYINT(1) NOT NULL DEFAULT 0,
  reportes_dias     INT NULL,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO planes_config (plan, precio_mensual, limite_usuarios, limite_sucursales, marca_propia, reportes_dias) VALUES
  ('trial',  0, NULL, NULL, 1, NULL),
  ('gratis', 0, 2,    1,    0, 30),
  ('pro',    0, NULL, NULL, 1, NULL);
