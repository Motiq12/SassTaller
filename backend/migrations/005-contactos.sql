-- =============================================================
-- Motiq — migracion 005: quien pide una demo
--
-- La landing tiene dos caminos. El taller chico se registra solo y ya existe
-- (/registro-taller). El grupo grande —varias sucursales, flota, decisiones por
-- comite— no se da de alta solo desde una pagina web: pide hablar con alguien.
--
-- Esta tabla es donde cae ese pedido. Sin ella el boton "Habla con nosotros" seria
-- decorativo, y un contacto de ese tamano perdido es plata perdida.
--
-- No lleva tenant_id a proposito: quien escribe todavia NO es un taller del
-- sistema. Es justo lo contrario, alguien de afuera preguntando.
-- =============================================================

CREATE TABLE IF NOT EXISTS contactos_demo (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  nombre       VARCHAR(120) NOT NULL,
  email        VARCHAR(150) NOT NULL,
  telefono     VARCHAR(40)  NULL,
  empresa      VARCHAR(150) NULL,
  -- Cuantos vehiculos mueven al mes: es lo que separa al taller de barrio del
  -- grupo grande, y decide a quien se llama primero.
  volumen      VARCHAR(40)  NULL,
  mensaje      TEXT NULL,
  estado       ENUM('nuevo','contactado','cerrado','descartado') NOT NULL DEFAULT 'nuevo',
  nota_interna VARCHAR(500) NULL,
  -- De donde salio (utm, campana). Sirve para saber que vale la pena y que no.
  origen       VARCHAR(80) NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- La bandeja se ordena por fecha y se filtra por estado.
  INDEX idx_contactos_estado (estado, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
