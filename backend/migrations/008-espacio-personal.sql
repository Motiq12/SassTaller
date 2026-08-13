-- =============================================================
-- Motiq — migracion 008: el espacio de trabajo de cada administrador
--
-- El panel es de los dos y los datos son compartidos: ambos administran TODO el
-- SaaS y tienen que seguir viendo los mismos talleres. Lo que no puede ser
-- compartido es lo de cada uno — a quien tengo que llamar yo, que talleres estoy
-- siguiendo de cerca, que hice ayer.
--
-- Sin esto, "lo que hay que hacer hoy" era igual para los dos, o sea de nadie: dos
-- personas mirando la misma lista de pendientes terminan llamando las dos al mismo
-- taller, o ninguna, cada una suponiendo que la otra ya lo hizo.
--
-- Ninguna de estas tablas lleva tenant_id: no son de un taller, son de la
-- plataforma. Cuelgan de plataforma_admins.
-- =============================================================

-- Lo que cada uno tiene pendiente. Puede estar atado a un taller o ser suelto
-- ("armar la propuesta de precios"), por eso tenant_id admite NULL.
CREATE TABLE IF NOT EXISTS motiq_tareas (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  admin_id   INT NOT NULL,
  texto      VARCHAR(300) NOT NULL,
  tenant_id  INT NULL,
  vence_el   DATE NULL,
  hecha      TINYINT(1) NOT NULL DEFAULT 0,
  hecha_en   DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tareas_admin (admin_id, hecha, vence_el),
  FOREIGN KEY (admin_id) REFERENCES plataforma_admins(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Los talleres que cada uno sigue de cerca. Con trece talleres no hace falta; con
-- doscientos, encontrar "los cinco que me importan" en la lista general es el
-- trabajo que nadie hace.
CREATE TABLE IF NOT EXISTS motiq_seguidos (
  admin_id   INT NOT NULL,
  tenant_id  INT NOT NULL,
  nota       VARCHAR(300) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (admin_id, tenant_id),
  FOREIGN KEY (admin_id) REFERENCES plataforma_admins(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Quien hizo que. Sirve para dos cosas a la vez: que cada uno vea su propia
-- actividad reciente en su espacio, y que quede registro de quien suspendio o borro
-- un taller. Lo segundo importa mas: son acciones que dejan a un cliente sin
-- trabajar, y hasta ahora solo quedaban en la consola del servidor.
--
-- El tenant_id NO lleva clave foranea a proposito: cuando se borra un taller, su
-- linea en la bitacora tiene que sobrevivir. Es justo la que hay que poder leer
-- despues.
CREATE TABLE IF NOT EXISTS motiq_bitacora (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  admin_id    INT NULL,
  admin_email VARCHAR(150) NULL,
  accion      VARCHAR(40) NOT NULL,
  tenant_id   INT NULL,
  tenant_slug VARCHAR(120) NULL,
  detalle     VARCHAR(300) NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bitacora_admin (admin_id, created_at),
  INDEX idx_bitacora_fecha (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
