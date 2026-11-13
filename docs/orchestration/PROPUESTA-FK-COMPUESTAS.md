# Propuesta (NO aplicada): claves foráneas compuestas (tenant_id, id)

Estado: **propuesta para revisión** (T04). No está en `backend/db/migraciones/` a propósito: el
migrador aplica todo lo que encuentra ahí al arrancar, y esto no debe llegar a producción sin que el
propietario corra antes la consulta de detección y revise su resultado.

## Por qué

Las FK actuales apuntan al `id` global (por ejemplo `citas.cliente_id -> clientes.id`), sin mirar el
taller. Por eso un `cliente_id` de otra empresa pasaba la base sin error, y la única defensa es el
código de cada ruta (`backend/src/utils/referencias.js`). Con una FK compuesta
`(tenant_id, cliente_id) -> clientes (tenant_id, id)` la propia base rechaza una fila que cuelgue de
otro taller, aunque una ruta nueva se olvide de validar. Tres columnas no tienen hoy ninguna FK y
quedan cubiertas por primera vez: `recompensas_canjeadas.orden_id` (QP-02),
`mensajes_internos.orden_id` y `mensajes_internos.sucursal_id`.

## Paso 1: detección (solo lectura, correr ANTES en producción)

Cuenta, por relación, las filas que hoy apuntan a otro taller, o a una orden o sede que no existe en el
suyo. Si alguna da más de 0, la validación del paso 3 fallaría: hay que conciliar esas filas a mano
(decidir con el propietario si se borran o se ponen en NULL) antes de seguir. El arreglo de las rutas
no repara filas que ya estén mal.

```sql
SELECT 'citas.cliente_id' AS relacion, COUNT(*) AS cruzadas FROM citas x JOIN clientes y ON y.id = x.cliente_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'citas.orden_id' AS relacion, COUNT(*) AS cruzadas FROM citas x JOIN ordenes_trabajo y ON y.id = x.orden_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'citas.sucursal_id' AS relacion, COUNT(*) AS cruzadas FROM citas x JOIN sucursales y ON y.id = x.sucursal_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'citas.tecnico_id' AS relacion, COUNT(*) AS cruzadas FROM citas x JOIN usuarios y ON y.id = x.tecnico_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'citas.usuario_id' AS relacion, COUNT(*) AS cruzadas FROM citas x JOIN usuarios y ON y.id = x.usuario_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'citas.vehiculo_id' AS relacion, COUNT(*) AS cruzadas FROM citas x JOIN vehiculos y ON y.id = x.vehiculo_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'cita_servicios.cita_id' AS relacion, COUNT(*) AS cruzadas FROM cita_servicios x JOIN citas y ON y.id = x.cita_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'email_verify_codes.cliente_id' AS relacion, COUNT(*) AS cruzadas FROM email_verify_codes x JOIN clientes y ON y.id = x.cliente_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'garantia_fotos.garantia_id' AS relacion, COUNT(*) AS cruzadas FROM garantia_fotos x JOIN garantias y ON y.id = x.garantia_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'garantias.creado_por' AS relacion, COUNT(*) AS cruzadas FROM garantias x JOIN usuarios y ON y.id = x.creado_por WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'garantias.orden_id' AS relacion, COUNT(*) AS cruzadas FROM garantias x JOIN ordenes_trabajo y ON y.id = x.orden_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'login_codes.cliente_id' AS relacion, COUNT(*) AS cruzadas FROM login_codes x JOIN clientes y ON y.id = x.cliente_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'mensajes_internos.destino_id' AS relacion, COUNT(*) AS cruzadas FROM mensajes_internos x JOIN usuarios y ON y.id = x.destino_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'mensajes_internos.remitente_id' AS relacion, COUNT(*) AS cruzadas FROM mensajes_internos x JOIN usuarios y ON y.id = x.remitente_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'mensajes_internos.orden_id' AS relacion, COUNT(*) AS cruzadas FROM mensajes_internos x JOIN ordenes_trabajo y ON y.id = x.orden_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'mensajes_internos.sucursal_id' AS relacion, COUNT(*) AS cruzadas FROM mensajes_internos x JOIN sucursales y ON y.id = x.sucursal_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'notificaciones.cita_id' AS relacion, COUNT(*) AS cruzadas FROM notificaciones x JOIN citas y ON y.id = x.cita_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'notificaciones.cliente_id' AS relacion, COUNT(*) AS cruzadas FROM notificaciones x JOIN clientes y ON y.id = x.cliente_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'orden_avances.orden_id' AS relacion, COUNT(*) AS cruzadas FROM orden_avances x JOIN ordenes_trabajo y ON y.id = x.orden_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'orden_avances.usuario_id' AS relacion, COUNT(*) AS cruzadas FROM orden_avances x JOIN usuarios y ON y.id = x.usuario_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'orden_checklist.orden_id' AS relacion, COUNT(*) AS cruzadas FROM orden_checklist x JOIN ordenes_trabajo y ON y.id = x.orden_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'orden_fotos.orden_id' AS relacion, COUNT(*) AS cruzadas FROM orden_fotos x JOIN ordenes_trabajo y ON y.id = x.orden_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'orden_repuestos.orden_id' AS relacion, COUNT(*) AS cruzadas FROM orden_repuestos x JOIN ordenes_trabajo y ON y.id = x.orden_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'orden_tiempos.orden_id' AS relacion, COUNT(*) AS cruzadas FROM orden_tiempos x JOIN ordenes_trabajo y ON y.id = x.orden_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'ordenes_trabajo.cliente_id' AS relacion, COUNT(*) AS cruzadas FROM ordenes_trabajo x JOIN clientes y ON y.id = x.cliente_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'ordenes_trabajo.recepcionista_id' AS relacion, COUNT(*) AS cruzadas FROM ordenes_trabajo x JOIN usuarios y ON y.id = x.recepcionista_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'ordenes_trabajo.sucursal_id' AS relacion, COUNT(*) AS cruzadas FROM ordenes_trabajo x JOIN sucursales y ON y.id = x.sucursal_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'ordenes_trabajo.tecnico_id' AS relacion, COUNT(*) AS cruzadas FROM ordenes_trabajo x JOIN usuarios y ON y.id = x.tecnico_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'ordenes_trabajo.vehiculo_id' AS relacion, COUNT(*) AS cruzadas FROM ordenes_trabajo x JOIN vehiculos y ON y.id = x.vehiculo_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'password_reset_codes.cliente_id' AS relacion, COUNT(*) AS cruzadas FROM password_reset_codes x JOIN clientes y ON y.id = x.cliente_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'recompensas_canjeadas.aplicado_por' AS relacion, COUNT(*) AS cruzadas FROM recompensas_canjeadas x JOIN usuarios y ON y.id = x.aplicado_por WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'recompensas_canjeadas.cliente_id' AS relacion, COUNT(*) AS cruzadas FROM recompensas_canjeadas x JOIN clientes y ON y.id = x.cliente_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'recompensas_canjeadas.orden_id' AS relacion, COUNT(*) AS cruzadas FROM recompensas_canjeadas x JOIN ordenes_trabajo y ON y.id = x.orden_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'tareas_mecanico.asignado_por' AS relacion, COUNT(*) AS cruzadas FROM tareas_mecanico x JOIN usuarios y ON y.id = x.asignado_por WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'tareas_mecanico.tecnico_id' AS relacion, COUNT(*) AS cruzadas FROM tareas_mecanico x JOIN usuarios y ON y.id = x.tecnico_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'usuario_verify_codes.usuario_id' AS relacion, COUNT(*) AS cruzadas FROM usuario_verify_codes x JOIN usuarios y ON y.id = x.usuario_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'usuario_reset_codes.usuario_id' AS relacion, COUNT(*) AS cruzadas FROM usuario_reset_codes x JOIN usuarios y ON y.id = x.usuario_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'usuarios.rol_id' AS relacion, COUNT(*) AS cruzadas FROM usuarios x JOIN roles y ON y.id = x.rol_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'usuarios.sucursal_id' AS relacion, COUNT(*) AS cruzadas FROM usuarios x JOIN sucursales y ON y.id = x.sucursal_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'vehiculos.cliente_id' AS relacion, COUNT(*) AS cruzadas FROM vehiculos x JOIN clientes y ON y.id = x.cliente_id WHERE x.tenant_id <> y.tenant_id
UNION ALL SELECT 'recompensas_canjeadas.orden_id (huérfana)', COUNT(*) FROM recompensas_canjeadas r WHERE r.orden_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ordenes_trabajo o WHERE o.id = r.orden_id AND o.tenant_id = r.tenant_id)
UNION ALL SELECT 'mensajes_internos.orden_id (huérfana)', COUNT(*) FROM mensajes_internos m WHERE m.orden_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ordenes_trabajo o WHERE o.id = m.orden_id AND o.tenant_id = m.tenant_id)
UNION ALL SELECT 'mensajes_internos.sucursal_id (huérfana)', COUNT(*) FROM mensajes_internos m WHERE m.sucursal_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sucursales s WHERE s.id = m.sucursal_id AND s.tenant_id = m.tenant_id)
ORDER BY cruzadas DESC, relacion;
```

`npm test` y la prueba de dos empresas corren la misma conciliación sobre sus bases de prueba
(`conciliar` en `backend/scripts/lib/casos-referencias.js`).

## Paso 2: índices únicos (tenant_id, id) en los padres

`CONCURRENTLY` no bloquea escrituras, pero no puede ir dentro de una transacción: si esto pasa a una
migración (0010 o la que toque), ese paso tiene que correr fuera de la transacción del migrador.

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_citas_tenant_id ON citas (tenant_id, id);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_clientes_tenant_id ON clientes (tenant_id, id);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_garantias_tenant_id ON garantias (tenant_id, id);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_ordenes_trabajo_tenant_id ON ordenes_trabajo (tenant_id, id);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_roles_tenant_id ON roles (tenant_id, id);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_sucursales_tenant_id ON sucursales (tenant_id, id);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_usuarios_tenant_id ON usuarios (tenant_id, id);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_vehiculos_tenant_id ON vehiculos (tenant_id, id);

ALTER TABLE citas ADD CONSTRAINT uq_citas_tenant_id UNIQUE USING INDEX ux_citas_tenant_id;
ALTER TABLE clientes ADD CONSTRAINT uq_clientes_tenant_id UNIQUE USING INDEX ux_clientes_tenant_id;
ALTER TABLE garantias ADD CONSTRAINT uq_garantias_tenant_id UNIQUE USING INDEX ux_garantias_tenant_id;
ALTER TABLE ordenes_trabajo ADD CONSTRAINT uq_ordenes_trabajo_tenant_id UNIQUE USING INDEX ux_ordenes_trabajo_tenant_id;
ALTER TABLE roles ADD CONSTRAINT uq_roles_tenant_id UNIQUE USING INDEX ux_roles_tenant_id;
ALTER TABLE sucursales ADD CONSTRAINT uq_sucursales_tenant_id UNIQUE USING INDEX ux_sucursales_tenant_id;
ALTER TABLE usuarios ADD CONSTRAINT uq_usuarios_tenant_id UNIQUE USING INDEX ux_usuarios_tenant_id;
ALTER TABLE vehiculos ADD CONSTRAINT uq_vehiculos_tenant_id UNIQUE USING INDEX ux_vehiculos_tenant_id;
```

## Paso 3: FK compuestas, primero NOT VALID y después VALIDATE

`NOT VALID` aplica la regla a toda fila nueva desde ese momento sin revisar las viejas (bloqueo breve).
`VALIDATE` revisa las existentes con un bloqueo que no frena lecturas ni escrituras; si el paso 1 dio
todo en 0, no falla. Las acciones `ON DELETE` copian las de las FK simples que ya existen:
`cita_servicios` borra en cascada y `usuarios.rol_id` queda en NULL (con la lista de columnas de
PostgreSQL 15+, para no anular `tenant_id`); el resto no deja borrar al padre, como hoy. Las FK
simples actuales se conservan.

```sql
ALTER TABLE citas ADD CONSTRAINT fkt_citas_cliente_id FOREIGN KEY (tenant_id, cliente_id) REFERENCES clientes (tenant_id, id) NOT VALID;
ALTER TABLE citas ADD CONSTRAINT fkt_citas_orden_id FOREIGN KEY (tenant_id, orden_id) REFERENCES ordenes_trabajo (tenant_id, id) NOT VALID;
ALTER TABLE citas ADD CONSTRAINT fkt_citas_sucursal_id FOREIGN KEY (tenant_id, sucursal_id) REFERENCES sucursales (tenant_id, id) NOT VALID;
ALTER TABLE citas ADD CONSTRAINT fkt_citas_tecnico_id FOREIGN KEY (tenant_id, tecnico_id) REFERENCES usuarios (tenant_id, id) NOT VALID;
ALTER TABLE citas ADD CONSTRAINT fkt_citas_usuario_id FOREIGN KEY (tenant_id, usuario_id) REFERENCES usuarios (tenant_id, id) NOT VALID;
ALTER TABLE citas ADD CONSTRAINT fkt_citas_vehiculo_id FOREIGN KEY (tenant_id, vehiculo_id) REFERENCES vehiculos (tenant_id, id) NOT VALID;
ALTER TABLE cita_servicios ADD CONSTRAINT fkt_cita_servicios_cita_id FOREIGN KEY (tenant_id, cita_id) REFERENCES citas (tenant_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE email_verify_codes ADD CONSTRAINT fkt_email_verify_codes_cliente_id FOREIGN KEY (tenant_id, cliente_id) REFERENCES clientes (tenant_id, id) NOT VALID;
ALTER TABLE garantia_fotos ADD CONSTRAINT fkt_garantia_fotos_garantia_id FOREIGN KEY (tenant_id, garantia_id) REFERENCES garantias (tenant_id, id) NOT VALID;
ALTER TABLE garantias ADD CONSTRAINT fkt_garantias_creado_por FOREIGN KEY (tenant_id, creado_por) REFERENCES usuarios (tenant_id, id) NOT VALID;
ALTER TABLE garantias ADD CONSTRAINT fkt_garantias_orden_id FOREIGN KEY (tenant_id, orden_id) REFERENCES ordenes_trabajo (tenant_id, id) NOT VALID;
ALTER TABLE login_codes ADD CONSTRAINT fkt_login_codes_cliente_id FOREIGN KEY (tenant_id, cliente_id) REFERENCES clientes (tenant_id, id) NOT VALID;
ALTER TABLE mensajes_internos ADD CONSTRAINT fkt_mensajes_internos_destino_id FOREIGN KEY (tenant_id, destino_id) REFERENCES usuarios (tenant_id, id) NOT VALID;
ALTER TABLE mensajes_internos ADD CONSTRAINT fkt_mensajes_internos_remitente_id FOREIGN KEY (tenant_id, remitente_id) REFERENCES usuarios (tenant_id, id) NOT VALID;
ALTER TABLE mensajes_internos ADD CONSTRAINT fkt_mensajes_internos_orden_id FOREIGN KEY (tenant_id, orden_id) REFERENCES ordenes_trabajo (tenant_id, id) NOT VALID;
ALTER TABLE mensajes_internos ADD CONSTRAINT fkt_mensajes_internos_sucursal_id FOREIGN KEY (tenant_id, sucursal_id) REFERENCES sucursales (tenant_id, id) NOT VALID;
ALTER TABLE notificaciones ADD CONSTRAINT fkt_notificaciones_cita_id FOREIGN KEY (tenant_id, cita_id) REFERENCES citas (tenant_id, id) NOT VALID;
ALTER TABLE notificaciones ADD CONSTRAINT fkt_notificaciones_cliente_id FOREIGN KEY (tenant_id, cliente_id) REFERENCES clientes (tenant_id, id) NOT VALID;
ALTER TABLE orden_avances ADD CONSTRAINT fkt_orden_avances_orden_id FOREIGN KEY (tenant_id, orden_id) REFERENCES ordenes_trabajo (tenant_id, id) NOT VALID;
ALTER TABLE orden_avances ADD CONSTRAINT fkt_orden_avances_usuario_id FOREIGN KEY (tenant_id, usuario_id) REFERENCES usuarios (tenant_id, id) NOT VALID;
ALTER TABLE orden_checklist ADD CONSTRAINT fkt_orden_checklist_orden_id FOREIGN KEY (tenant_id, orden_id) REFERENCES ordenes_trabajo (tenant_id, id) NOT VALID;
ALTER TABLE orden_fotos ADD CONSTRAINT fkt_orden_fotos_orden_id FOREIGN KEY (tenant_id, orden_id) REFERENCES ordenes_trabajo (tenant_id, id) NOT VALID;
ALTER TABLE orden_repuestos ADD CONSTRAINT fkt_orden_repuestos_orden_id FOREIGN KEY (tenant_id, orden_id) REFERENCES ordenes_trabajo (tenant_id, id) NOT VALID;
ALTER TABLE orden_tiempos ADD CONSTRAINT fkt_orden_tiempos_orden_id FOREIGN KEY (tenant_id, orden_id) REFERENCES ordenes_trabajo (tenant_id, id) NOT VALID;
ALTER TABLE ordenes_trabajo ADD CONSTRAINT fkt_ordenes_trabajo_cliente_id FOREIGN KEY (tenant_id, cliente_id) REFERENCES clientes (tenant_id, id) NOT VALID;
ALTER TABLE ordenes_trabajo ADD CONSTRAINT fkt_ordenes_trabajo_recepcionista_id FOREIGN KEY (tenant_id, recepcionista_id) REFERENCES usuarios (tenant_id, id) NOT VALID;
ALTER TABLE ordenes_trabajo ADD CONSTRAINT fkt_ordenes_trabajo_sucursal_id FOREIGN KEY (tenant_id, sucursal_id) REFERENCES sucursales (tenant_id, id) NOT VALID;
ALTER TABLE ordenes_trabajo ADD CONSTRAINT fkt_ordenes_trabajo_tecnico_id FOREIGN KEY (tenant_id, tecnico_id) REFERENCES usuarios (tenant_id, id) NOT VALID;
ALTER TABLE ordenes_trabajo ADD CONSTRAINT fkt_ordenes_trabajo_vehiculo_id FOREIGN KEY (tenant_id, vehiculo_id) REFERENCES vehiculos (tenant_id, id) NOT VALID;
ALTER TABLE password_reset_codes ADD CONSTRAINT fkt_password_reset_codes_cliente_id FOREIGN KEY (tenant_id, cliente_id) REFERENCES clientes (tenant_id, id) NOT VALID;
ALTER TABLE recompensas_canjeadas ADD CONSTRAINT fkt_recompensas_canjeadas_aplicado_por FOREIGN KEY (tenant_id, aplicado_por) REFERENCES usuarios (tenant_id, id) NOT VALID;
ALTER TABLE recompensas_canjeadas ADD CONSTRAINT fkt_recompensas_canjeadas_cliente_id FOREIGN KEY (tenant_id, cliente_id) REFERENCES clientes (tenant_id, id) NOT VALID;
ALTER TABLE recompensas_canjeadas ADD CONSTRAINT fkt_recompensas_canjeadas_orden_id FOREIGN KEY (tenant_id, orden_id) REFERENCES ordenes_trabajo (tenant_id, id) NOT VALID;
ALTER TABLE tareas_mecanico ADD CONSTRAINT fkt_tareas_mecanico_asignado_por FOREIGN KEY (tenant_id, asignado_por) REFERENCES usuarios (tenant_id, id) NOT VALID;
ALTER TABLE tareas_mecanico ADD CONSTRAINT fkt_tareas_mecanico_tecnico_id FOREIGN KEY (tenant_id, tecnico_id) REFERENCES usuarios (tenant_id, id) NOT VALID;
ALTER TABLE usuario_verify_codes ADD CONSTRAINT fkt_usuario_verify_codes_usuario_id FOREIGN KEY (tenant_id, usuario_id) REFERENCES usuarios (tenant_id, id) NOT VALID;
ALTER TABLE usuario_reset_codes ADD CONSTRAINT fkt_usuario_reset_codes_usuario_id FOREIGN KEY (tenant_id, usuario_id) REFERENCES usuarios (tenant_id, id) NOT VALID;
ALTER TABLE usuarios ADD CONSTRAINT fkt_usuarios_rol_id FOREIGN KEY (tenant_id, rol_id) REFERENCES roles (tenant_id, id) ON DELETE SET NULL (rol_id) NOT VALID;
ALTER TABLE usuarios ADD CONSTRAINT fkt_usuarios_sucursal_id FOREIGN KEY (tenant_id, sucursal_id) REFERENCES sucursales (tenant_id, id) NOT VALID;
ALTER TABLE vehiculos ADD CONSTRAINT fkt_vehiculos_cliente_id FOREIGN KEY (tenant_id, cliente_id) REFERENCES clientes (tenant_id, id) NOT VALID;

ALTER TABLE citas VALIDATE CONSTRAINT fkt_citas_cliente_id;
ALTER TABLE citas VALIDATE CONSTRAINT fkt_citas_orden_id;
ALTER TABLE citas VALIDATE CONSTRAINT fkt_citas_sucursal_id;
ALTER TABLE citas VALIDATE CONSTRAINT fkt_citas_tecnico_id;
ALTER TABLE citas VALIDATE CONSTRAINT fkt_citas_usuario_id;
ALTER TABLE citas VALIDATE CONSTRAINT fkt_citas_vehiculo_id;
ALTER TABLE cita_servicios VALIDATE CONSTRAINT fkt_cita_servicios_cita_id;
ALTER TABLE email_verify_codes VALIDATE CONSTRAINT fkt_email_verify_codes_cliente_id;
ALTER TABLE garantia_fotos VALIDATE CONSTRAINT fkt_garantia_fotos_garantia_id;
ALTER TABLE garantias VALIDATE CONSTRAINT fkt_garantias_creado_por;
ALTER TABLE garantias VALIDATE CONSTRAINT fkt_garantias_orden_id;
ALTER TABLE login_codes VALIDATE CONSTRAINT fkt_login_codes_cliente_id;
ALTER TABLE mensajes_internos VALIDATE CONSTRAINT fkt_mensajes_internos_destino_id;
ALTER TABLE mensajes_internos VALIDATE CONSTRAINT fkt_mensajes_internos_remitente_id;
ALTER TABLE mensajes_internos VALIDATE CONSTRAINT fkt_mensajes_internos_orden_id;
ALTER TABLE mensajes_internos VALIDATE CONSTRAINT fkt_mensajes_internos_sucursal_id;
ALTER TABLE notificaciones VALIDATE CONSTRAINT fkt_notificaciones_cita_id;
ALTER TABLE notificaciones VALIDATE CONSTRAINT fkt_notificaciones_cliente_id;
ALTER TABLE orden_avances VALIDATE CONSTRAINT fkt_orden_avances_orden_id;
ALTER TABLE orden_avances VALIDATE CONSTRAINT fkt_orden_avances_usuario_id;
ALTER TABLE orden_checklist VALIDATE CONSTRAINT fkt_orden_checklist_orden_id;
ALTER TABLE orden_fotos VALIDATE CONSTRAINT fkt_orden_fotos_orden_id;
ALTER TABLE orden_repuestos VALIDATE CONSTRAINT fkt_orden_repuestos_orden_id;
ALTER TABLE orden_tiempos VALIDATE CONSTRAINT fkt_orden_tiempos_orden_id;
ALTER TABLE ordenes_trabajo VALIDATE CONSTRAINT fkt_ordenes_trabajo_cliente_id;
ALTER TABLE ordenes_trabajo VALIDATE CONSTRAINT fkt_ordenes_trabajo_recepcionista_id;
ALTER TABLE ordenes_trabajo VALIDATE CONSTRAINT fkt_ordenes_trabajo_sucursal_id;
ALTER TABLE ordenes_trabajo VALIDATE CONSTRAINT fkt_ordenes_trabajo_tecnico_id;
ALTER TABLE ordenes_trabajo VALIDATE CONSTRAINT fkt_ordenes_trabajo_vehiculo_id;
ALTER TABLE password_reset_codes VALIDATE CONSTRAINT fkt_password_reset_codes_cliente_id;
ALTER TABLE recompensas_canjeadas VALIDATE CONSTRAINT fkt_recompensas_canjeadas_aplicado_por;
ALTER TABLE recompensas_canjeadas VALIDATE CONSTRAINT fkt_recompensas_canjeadas_cliente_id;
ALTER TABLE recompensas_canjeadas VALIDATE CONSTRAINT fkt_recompensas_canjeadas_orden_id;
ALTER TABLE tareas_mecanico VALIDATE CONSTRAINT fkt_tareas_mecanico_asignado_por;
ALTER TABLE tareas_mecanico VALIDATE CONSTRAINT fkt_tareas_mecanico_tecnico_id;
ALTER TABLE usuario_verify_codes VALIDATE CONSTRAINT fkt_usuario_verify_codes_usuario_id;
ALTER TABLE usuario_reset_codes VALIDATE CONSTRAINT fkt_usuario_reset_codes_usuario_id;
ALTER TABLE usuarios VALIDATE CONSTRAINT fkt_usuarios_rol_id;
ALTER TABLE usuarios VALIDATE CONSTRAINT fkt_usuarios_sucursal_id;
ALTER TABLE vehiculos VALIDATE CONSTRAINT fkt_vehiculos_cliente_id;
```

## Vuelta atrás

```sql
ALTER TABLE citas DROP CONSTRAINT IF EXISTS fkt_citas_cliente_id;
ALTER TABLE citas DROP CONSTRAINT IF EXISTS fkt_citas_orden_id;
ALTER TABLE citas DROP CONSTRAINT IF EXISTS fkt_citas_sucursal_id;
ALTER TABLE citas DROP CONSTRAINT IF EXISTS fkt_citas_tecnico_id;
ALTER TABLE citas DROP CONSTRAINT IF EXISTS fkt_citas_usuario_id;
ALTER TABLE citas DROP CONSTRAINT IF EXISTS fkt_citas_vehiculo_id;
ALTER TABLE cita_servicios DROP CONSTRAINT IF EXISTS fkt_cita_servicios_cita_id;
ALTER TABLE email_verify_codes DROP CONSTRAINT IF EXISTS fkt_email_verify_codes_cliente_id;
ALTER TABLE garantia_fotos DROP CONSTRAINT IF EXISTS fkt_garantia_fotos_garantia_id;
ALTER TABLE garantias DROP CONSTRAINT IF EXISTS fkt_garantias_creado_por;
ALTER TABLE garantias DROP CONSTRAINT IF EXISTS fkt_garantias_orden_id;
ALTER TABLE login_codes DROP CONSTRAINT IF EXISTS fkt_login_codes_cliente_id;
ALTER TABLE mensajes_internos DROP CONSTRAINT IF EXISTS fkt_mensajes_internos_destino_id;
ALTER TABLE mensajes_internos DROP CONSTRAINT IF EXISTS fkt_mensajes_internos_remitente_id;
ALTER TABLE mensajes_internos DROP CONSTRAINT IF EXISTS fkt_mensajes_internos_orden_id;
ALTER TABLE mensajes_internos DROP CONSTRAINT IF EXISTS fkt_mensajes_internos_sucursal_id;
ALTER TABLE notificaciones DROP CONSTRAINT IF EXISTS fkt_notificaciones_cita_id;
ALTER TABLE notificaciones DROP CONSTRAINT IF EXISTS fkt_notificaciones_cliente_id;
ALTER TABLE orden_avances DROP CONSTRAINT IF EXISTS fkt_orden_avances_orden_id;
ALTER TABLE orden_avances DROP CONSTRAINT IF EXISTS fkt_orden_avances_usuario_id;
ALTER TABLE orden_checklist DROP CONSTRAINT IF EXISTS fkt_orden_checklist_orden_id;
ALTER TABLE orden_fotos DROP CONSTRAINT IF EXISTS fkt_orden_fotos_orden_id;
ALTER TABLE orden_repuestos DROP CONSTRAINT IF EXISTS fkt_orden_repuestos_orden_id;
ALTER TABLE orden_tiempos DROP CONSTRAINT IF EXISTS fkt_orden_tiempos_orden_id;
ALTER TABLE ordenes_trabajo DROP CONSTRAINT IF EXISTS fkt_ordenes_trabajo_cliente_id;
ALTER TABLE ordenes_trabajo DROP CONSTRAINT IF EXISTS fkt_ordenes_trabajo_recepcionista_id;
ALTER TABLE ordenes_trabajo DROP CONSTRAINT IF EXISTS fkt_ordenes_trabajo_sucursal_id;
ALTER TABLE ordenes_trabajo DROP CONSTRAINT IF EXISTS fkt_ordenes_trabajo_tecnico_id;
ALTER TABLE ordenes_trabajo DROP CONSTRAINT IF EXISTS fkt_ordenes_trabajo_vehiculo_id;
ALTER TABLE password_reset_codes DROP CONSTRAINT IF EXISTS fkt_password_reset_codes_cliente_id;
ALTER TABLE recompensas_canjeadas DROP CONSTRAINT IF EXISTS fkt_recompensas_canjeadas_aplicado_por;
ALTER TABLE recompensas_canjeadas DROP CONSTRAINT IF EXISTS fkt_recompensas_canjeadas_cliente_id;
ALTER TABLE recompensas_canjeadas DROP CONSTRAINT IF EXISTS fkt_recompensas_canjeadas_orden_id;
ALTER TABLE tareas_mecanico DROP CONSTRAINT IF EXISTS fkt_tareas_mecanico_asignado_por;
ALTER TABLE tareas_mecanico DROP CONSTRAINT IF EXISTS fkt_tareas_mecanico_tecnico_id;
ALTER TABLE usuario_verify_codes DROP CONSTRAINT IF EXISTS fkt_usuario_verify_codes_usuario_id;
ALTER TABLE usuario_reset_codes DROP CONSTRAINT IF EXISTS fkt_usuario_reset_codes_usuario_id;
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS fkt_usuarios_rol_id;
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS fkt_usuarios_sucursal_id;
ALTER TABLE vehiculos DROP CONSTRAINT IF EXISTS fkt_vehiculos_cliente_id;
ALTER TABLE citas DROP CONSTRAINT IF EXISTS uq_citas_tenant_id;
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS uq_clientes_tenant_id;
ALTER TABLE garantias DROP CONSTRAINT IF EXISTS uq_garantias_tenant_id;
ALTER TABLE ordenes_trabajo DROP CONSTRAINT IF EXISTS uq_ordenes_trabajo_tenant_id;
ALTER TABLE roles DROP CONSTRAINT IF EXISTS uq_roles_tenant_id;
ALTER TABLE sucursales DROP CONSTRAINT IF EXISTS uq_sucursales_tenant_id;
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS uq_usuarios_tenant_id;
ALTER TABLE vehiculos DROP CONSTRAINT IF EXISTS uq_vehiculos_tenant_id;
```

## Lo que se verificó (sin tocar producción)

- Paso 1 sobre las bases de prueba `motiq_t04_test` y `sasstaller_e2e_t04` (PostgreSQL 18.6, puerto 5433):
  todas las relaciones en 0.
- Pasos 2 y 3 sobre una copia de `sasstaller_e2e_t04`: las 40 restricciones quedan creadas y validadas;
  un `INSERT` en `recompensas_canjeadas` con la orden de otro taller se rechaza con
  `fkt_recompensas_canjeadas_orden_id`; la vuelta atrás se aplica sin errores. La copia se borró después.
- El borrado de un taller (`backend/scripts/borrar-taller.js`) deduce el orden del esquema vivo
  (`backend/src/utils/orden-borrado.js`), así que incorpora estas FK sin cambios. Borrar una orden ya pone
  `mensajes_internos.orden_id` en NULL y borra sus canjes antes de borrarla.

## Pendiente del propietario

1. Correr el paso 1 en producción (solo lectura) y conciliar lo que aparezca.
2. Elegir la ventana para los pasos 2 y 3 y pasarlos a una migración aditiva.
