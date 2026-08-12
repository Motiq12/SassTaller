-- =============================================================
-- SassTaller — migracion 001: multi-tenancy
-- Generado desde el esquema real de proyecto_taller.
--
-- Modelo: base compartida + columna tenant_id en TODAS las tablas
-- (denormalizada tambien en las hijas). Se elige denormalizar para que
-- cada consulta pueda filtrar por tenant sin joins hacia la raiz: un
-- olvido de join no puede convertirse en una fuga entre talleres.
--
-- sucursales pasa a colgar del tenant: un taller (tenant) tiene N sedes.
-- =============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- 1) Tabla raiz de inquilinos (cada taller suscriptor del SaaS).
CREATE TABLE IF NOT EXISTS tenants (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(150) NOT NULL,
  slug        VARCHAR(60)  NOT NULL COMMENT 'subdominio/identificador publico',
  plan        VARCHAR(30)  NOT NULL DEFAULT 'trial',
  estado      VARCHAR(20)  NOT NULL DEFAULT 'activo' COMMENT 'activo|suspendido|cancelado',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tenant 1 = el taller que ya existia. Todo lo actual queda bajo el.
INSERT IGNORE INTO tenants (id, nombre, slug, plan, estado)
VALUES (1, 'MS Motors', 'ms-motors', 'pro', 'activo');

-- 2) tenant_id en cada tabla. Se agrega con DEFAULT 1 para rellenar las
--    filas existentes y luego se QUITA el default: asi ningun INSERT nuevo
--    puede caer en un tenant por accidente, tiene que declararlo.

ALTER TABLE `citas` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `citas` ADD INDEX idx_citas_tenant (tenant_id);
ALTER TABLE `citas` ADD CONSTRAINT fk_citas_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE `clientes` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `clientes` ADD INDEX idx_clientes_tenant (tenant_id);
ALTER TABLE `clientes` ADD CONSTRAINT fk_clientes_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE `configuracion` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `configuracion` ADD INDEX idx_configuracion_tenant (tenant_id);
ALTER TABLE `configuracion` ADD CONSTRAINT fk_configuracion_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE `email_verify_codes` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `email_verify_codes` ADD INDEX idx_email_verify_codes_tenant (tenant_id);
ALTER TABLE `email_verify_codes` ADD CONSTRAINT fk_email_verify_codes_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE `garantia_fotos` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `garantia_fotos` ADD INDEX idx_garantia_fotos_tenant (tenant_id);
ALTER TABLE `garantia_fotos` ADD CONSTRAINT fk_garantia_fotos_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE `garantias` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `garantias` ADD INDEX idx_garantias_tenant (tenant_id);
ALTER TABLE `garantias` ADD CONSTRAINT fk_garantias_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE `login_codes` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `login_codes` ADD INDEX idx_login_codes_tenant (tenant_id);
ALTER TABLE `login_codes` ADD CONSTRAINT fk_login_codes_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE `mensaje_lecturas` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `mensaje_lecturas` ADD INDEX idx_mensaje_lecturas_tenant (tenant_id);
ALTER TABLE `mensaje_lecturas` ADD CONSTRAINT fk_mensaje_lecturas_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE `mensajes_internos` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `mensajes_internos` ADD INDEX idx_mensajes_internos_tenant (tenant_id);
ALTER TABLE `mensajes_internos` ADD CONSTRAINT fk_mensajes_internos_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE `motos` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `motos` ADD INDEX idx_motos_tenant (tenant_id);
ALTER TABLE `motos` ADD CONSTRAINT fk_motos_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE `notificaciones` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `notificaciones` ADD INDEX idx_notificaciones_tenant (tenant_id);
ALTER TABLE `notificaciones` ADD CONSTRAINT fk_notificaciones_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE `orden_avances` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `orden_avances` ADD INDEX idx_orden_avances_tenant (tenant_id);
ALTER TABLE `orden_avances` ADD CONSTRAINT fk_orden_avances_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE `orden_checklist` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `orden_checklist` ADD INDEX idx_orden_checklist_tenant (tenant_id);
ALTER TABLE `orden_checklist` ADD CONSTRAINT fk_orden_checklist_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE `orden_contadores` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `orden_contadores` ADD INDEX idx_orden_contadores_tenant (tenant_id);
ALTER TABLE `orden_contadores` ADD CONSTRAINT fk_orden_contadores_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE `orden_fotos` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `orden_fotos` ADD INDEX idx_orden_fotos_tenant (tenant_id);
ALTER TABLE `orden_fotos` ADD CONSTRAINT fk_orden_fotos_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE `orden_repuestos` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `orden_repuestos` ADD INDEX idx_orden_repuestos_tenant (tenant_id);
ALTER TABLE `orden_repuestos` ADD CONSTRAINT fk_orden_repuestos_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE `orden_tiempos` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `orden_tiempos` ADD INDEX idx_orden_tiempos_tenant (tenant_id);
ALTER TABLE `orden_tiempos` ADD CONSTRAINT fk_orden_tiempos_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE `ordenes_trabajo` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `ordenes_trabajo` ADD INDEX idx_ordenes_trabajo_tenant (tenant_id);
ALTER TABLE `ordenes_trabajo` ADD CONSTRAINT fk_ordenes_trabajo_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE `password_reset_codes` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `password_reset_codes` ADD INDEX idx_password_reset_codes_tenant (tenant_id);
ALTER TABLE `password_reset_codes` ADD CONSTRAINT fk_password_reset_codes_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE `promos` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `promos` ADD INDEX idx_promos_tenant (tenant_id);
ALTER TABLE `promos` ADD CONSTRAINT fk_promos_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE `recompensas_canjeadas` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `recompensas_canjeadas` ADD INDEX idx_recompensas_canjeadas_tenant (tenant_id);
ALTER TABLE `recompensas_canjeadas` ADD CONSTRAINT fk_recompensas_canjeadas_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE `servicios` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `servicios` ADD INDEX idx_servicios_tenant (tenant_id);
ALTER TABLE `servicios` ADD CONSTRAINT fk_servicios_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE `sucursales` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `sucursales` ADD INDEX idx_sucursales_tenant (tenant_id);
ALTER TABLE `sucursales` ADD CONSTRAINT fk_sucursales_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE `tareas_mecanico` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `tareas_mecanico` ADD INDEX idx_tareas_mecanico_tenant (tenant_id);
ALTER TABLE `tareas_mecanico` ADD CONSTRAINT fk_tareas_mecanico_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE `usuarios` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `usuarios` ADD INDEX idx_usuarios_tenant (tenant_id);
ALTER TABLE `usuarios` ADD CONSTRAINT fk_usuarios_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE `web_vitals` ADD COLUMN tenant_id INT NOT NULL DEFAULT 1;
ALTER TABLE `web_vitals` ADD INDEX idx_web_vitals_tenant (tenant_id);
ALTER TABLE `web_vitals` ADD CONSTRAINT fk_web_vitals_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- 3) Unicidad: los indices globales pasan a ser por tenant. Sin esto, el
--    taller B no podria registrar un correo, una placa o un nombre de
--    servicio que el taller A ya use.

ALTER TABLE `usuarios` DROP INDEX `email`;
ALTER TABLE `usuarios` ADD UNIQUE KEY uq_usuarios_tenant (tenant_id, `email`);
ALTER TABLE `servicios` DROP INDEX `uq_servicio_nombre`;
ALTER TABLE `servicios` ADD UNIQUE KEY uq_servicios_tenant (tenant_id, `nombre`);
ALTER TABLE `motos` DROP INDEX `uq_motos_placa_norm`;
ALTER TABLE `motos` ADD UNIQUE KEY uq_motos_tenant (tenant_id, `placa_norm`);
ALTER TABLE `ordenes_trabajo` DROP INDEX `numero_orden`;
ALTER TABLE `ordenes_trabajo` ADD UNIQUE KEY uq_ordenes_trabajo_tenant (tenant_id, `numero_orden`);
ALTER TABLE `orden_contadores` DROP PRIMARY KEY, ADD PRIMARY KEY (tenant_id, `anio`);
ALTER TABLE `configuracion` DROP PRIMARY KEY, ADD PRIMARY KEY (tenant_id, `id`);

-- 4) Quitar el DEFAULT 1 una vez rellenadas las filas existentes.

ALTER TABLE `citas` ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE `clientes` ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE `configuracion` ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE `email_verify_codes` ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE `garantia_fotos` ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE `garantias` ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE `login_codes` ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE `mensaje_lecturas` ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE `mensajes_internos` ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE `motos` ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE `notificaciones` ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE `orden_avances` ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE `orden_checklist` ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE `orden_contadores` ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE `orden_fotos` ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE `orden_repuestos` ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE `orden_tiempos` ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE `ordenes_trabajo` ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE `password_reset_codes` ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE `promos` ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE `recompensas_canjeadas` ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE `servicios` ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE `sucursales` ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE `tareas_mecanico` ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE `usuarios` ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE `web_vitals` ALTER COLUMN tenant_id DROP DEFAULT;

SET FOREIGN_KEY_CHECKS = 1;
