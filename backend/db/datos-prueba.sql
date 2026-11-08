-- Datos de prueba de Motiq. Generado por `npm run db:exportar` el 2026-11-08.
-- Se carga sobre una base recién migrada (npm run db:importar). Sin contraseñas que
-- funcionen ni cuentas de plataforma: ver db/exportar.js.

SET TIME ZONE 'UTC';
BEGIN;
SET CONSTRAINTS ALL DEFERRED;

INSERT INTO "citas" ("id", "cliente_id", "vehiculo_id", "usuario_id", "tecnico_id", "sucursal_id", "fecha", "hora", "motivo", "tipo_servicio", "estado", "monto", "calificacion", "comentario_satisfaccion", "fecha_inicio", "fecha_fin", "hora_llegada", "orden_id", "created_at", "updated_at", "confirmada_cliente", "fecha_listo", "recordatorio_enviado", "no_show", "fecha_cancelacion", "tenant_id", "es_ejemplo") VALUES
  ('1', '1', NULL, NULL, NULL, '1', '2026-08-20', '09:00:00', 'CITA-DEL-TALLER-1', NULL, 'agendado', '0.00', NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-12 01:46:08+00', '2026-08-12 01:47:06+00', '0', NULL, '0', '0', NULL, '1', '0'),
  ('2', '2', NULL, NULL, NULL, '1', '2026-08-20', '10:00:00', 'CITA-DEL-TALLER-2', NULL, 'agendado', '0.00', NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-12 01:46:08+00', '2026-08-12 01:47:06+00', '0', NULL, '0', '0', NULL, '2', '0');
SELECT setval(pg_get_serial_sequence('citas', 'id'), (SELECT MAX("id") FROM "citas"));
INSERT INTO "clientes" ("id", "nombre", "apellido", "telefono", "email", "cedula", "direccion", "password_hash", "visitas", "cortesia_disponible", "notif_avances", "notif_recordatorios", "activo", "created_at", "updated_at", "foto", "email_verificado", "email_pendiente", "tenant_id", "es_ejemplo") VALUES
  ('1', 'Cliente', 'DelUno', '111-1111', NULL, NULL, NULL, NULL, '0', '0', '1', '1', '1', '2026-08-12 01:46:08+00', '2026-08-12 01:46:08+00', NULL, '1', NULL, '1', '0'),
  ('2', 'Cliente', 'DelDos', '222-2222', NULL, NULL, NULL, NULL, '0', '0', '1', '1', '1', '2026-08-12 01:46:08+00', '2026-08-12 01:46:08+00', NULL, '1', NULL, '2', '0'),
  ('33', 'Ana', 'Uno', '8888-1111', 'cliente-1786557361919@t.com', '1-2222-3333', NULL, '!sin-password!', '0', '0', '1', '1', '1', '2026-08-12 17:56:02+00', '2026-08-12 17:56:02+00', NULL, '1', NULL, '1', '0'),
  ('34', 'Ana', 'Dos', '8888-2222', 'cliente-1786557361919@t.com', '1-2222-3333', NULL, '!sin-password!', '0', '0', '1', '1', '1', '2026-08-12 17:56:02+00', '2026-08-12 17:56:02+00', NULL, '1', NULL, '2', '0'),
  ('35', 'Ana', 'Uno', '8888-1111', 'cliente-1786558071993@t.com', '1-2222-3333', NULL, '!sin-password!', '0', '0', '1', '1', '1', '2026-08-12 18:07:52+00', '2026-08-12 18:07:52+00', NULL, '1', NULL, '1', '0'),
  ('36', 'Ana', 'Dos', '8888-2222', 'cliente-1786558071993@t.com', '1-2222-3333', NULL, '!sin-password!', '0', '0', '1', '1', '1', '2026-08-12 18:07:52+00', '2026-08-12 18:07:52+00', NULL, '1', NULL, '2', '0'),
  ('37', 'Ana', 'Uno', '8888-1111', 'cliente-1786558348758@t.com', '1-2222-3333', NULL, '!sin-password!', '0', '0', '1', '1', '1', '2026-08-12 18:12:28+00', '2026-08-12 18:12:29+00', NULL, '1', NULL, '1', '0'),
  ('38', 'Ana', 'Dos', '8888-2222', 'cliente-1786558348758@t.com', '1-2222-3333', NULL, '!sin-password!', '0', '0', '1', '1', '1', '2026-08-12 18:12:28+00', '2026-08-12 18:12:29+00', NULL, '1', NULL, '2', '0'),
  ('40', 'Ana', 'Uno', '8888-1111', 'cliente-1786563032083@t.com', '1-2222-3333', NULL, '!sin-password!', '0', '0', '1', '1', '1', '2026-08-12 19:30:32+00', '2026-08-12 19:30:32+00', NULL, '1', NULL, '1', '0'),
  ('41', 'Ana', 'Dos', '8888-2222', 'cliente-1786563032083@t.com', '1-2222-3333', NULL, '!sin-password!', '0', '0', '1', '1', '1', '2026-08-12 19:30:32+00', '2026-08-12 19:30:32+00', NULL, '1', NULL, '2', '0'),
  ('44', 'Ana', 'Uno', '8888-1111', 'cliente-1786564589328@t.com', '1-2222-3333', NULL, '!sin-password!', '0', '0', '1', '1', '1', '2026-08-12 19:56:29+00', '2026-08-12 19:56:29+00', NULL, '1', NULL, '1', '0'),
  ('45', 'Ana', 'Dos', '8888-2222', 'cliente-1786564589328@t.com', '1-2222-3333', NULL, '!sin-password!', '0', '0', '1', '1', '1', '2026-08-12 19:56:29+00', '2026-08-12 19:56:29+00', NULL, '1', NULL, '2', '0'),
  ('46', 'Ana', 'Uno', '8888-1111', 'cliente-1786572350264@t.com', '1-2222-3333', NULL, '!sin-password!', '0', '0', '1', '1', '1', '2026-08-12 22:05:50+00', '2026-08-12 22:05:51+00', NULL, '1', NULL, '1', '0'),
  ('47', 'Ana', 'Dos', '8888-2222', 'cliente-1786572350264@t.com', '1-2222-3333', NULL, '!sin-password!', '0', '0', '1', '1', '1', '2026-08-12 22:05:50+00', '2026-08-12 22:05:51+00', NULL, '1', NULL, '2', '0'),
  ('48', 'Ana', 'Uno', '8888-1111', 'cliente-1786572579853@t.com', '1-2222-3333', NULL, '!sin-password!', '0', '0', '1', '1', '1', '2026-08-12 22:09:39+00', '2026-08-12 22:09:40+00', NULL, '1', NULL, '1', '0'),
  ('49', 'Ana', 'Dos', '8888-2222', 'cliente-1786572579853@t.com', '1-2222-3333', NULL, '!sin-password!', '0', '0', '1', '1', '1', '2026-08-12 22:09:40+00', '2026-08-12 22:09:40+00', NULL, '1', NULL, '2', '0'),
  ('54', 'Ana', 'Uno', '8888-1111', 'cliente-1786578529261@t.com', '1-2222-3333', NULL, '!sin-password!', '0', '0', '1', '1', '1', '2026-08-12 23:48:49+00', '2026-08-12 23:48:49+00', NULL, '1', NULL, '1', '0'),
  ('55', 'Ana', 'Dos', '8888-2222', 'cliente-1786578529261@t.com', '1-2222-3333', NULL, '!sin-password!', '0', '0', '1', '1', '1', '2026-08-12 23:48:49+00', '2026-08-12 23:48:49+00', NULL, '1', NULL, '2', '0'),
  ('56', 'Ana', 'Uno', '8888-1111', 'cliente-1786580238153@t.com', '1-2222-3333', NULL, '!sin-password!', '0', '0', '1', '1', '1', '2026-08-13 00:17:18+00', '2026-08-13 00:17:18+00', NULL, '1', NULL, '1', '0'),
  ('57', 'Ana', 'Dos', '8888-2222', 'cliente-1786580238153@t.com', '1-2222-3333', NULL, '!sin-password!', '0', '0', '1', '1', '1', '2026-08-13 00:17:18+00', '2026-08-13 00:17:18+00', NULL, '1', NULL, '2', '0');
SELECT setval(pg_get_serial_sequence('clientes', 'id'), (SELECT MAX("id") FROM "clientes"));
INSERT INTO "configuracion" ("id", "nombre_taller", "telefono", "email", "direccion", "logo", "max_citas_hora", "dias_anticipacion", "duracion_cita_min", "horarios", "notif_estado", "notif_recordatorio", "notif_cotizacion", "notif_email_entrega", "updated_at", "cancelacion_horas_min", "visitas_para_cortesia", "zona_horaria_offset", "garantia_dias", "metodos_pago", "tenant_id", "tipos_vehiculo", "color_primario", "arranque_oculto") VALUES
  ('1', 'MS Motos', NULL, NULL, NULL, NULL, '2', '30', '90', '[{"dia": 1, "abre": "08:00", "activo": 1, "cierra": "17:00"}, {"dia": 2, "abre": "08:00", "activo": 1, "cierra": "17:00"}, {"dia": 3, "abre": "08:00", "activo": 1, "cierra": "17:00"}, {"dia": 4, "abre": "08:00", "activo": 1, "cierra": "17:00"}, {"dia": 5, "abre": "08:00", "activo": 1, "cierra": "17:00"}, {"dia": 6, "abre": "08:00", "activo": 1, "cierra": "13:00"}, {"dia": 0, "abre": "08:00", "activo": 0, "cierra": "13:00"}]', '1', '1', '1', '0', '2026-08-13 06:06:55+00', '2', '7', '-6', '30', '[{"valor": "efectivo", "etiqueta": "Efectivo"}, {"valor": "sinpe", "etiqueta": "SINPE Móvil"}, {"valor": "tarjeta", "etiqueta": "Tarjeta"}, {"valor": "transferencia", "etiqueta": "Transferencia"}]', '1', '["moto"]', '#e11d48', '0'),
  ('1', 'Moto Zone', NULL, NULL, NULL, NULL, '2', '30', '90', '[{"dia": 1, "abre": "08:00", "activo": 1, "cierra": "17:00"}, {"dia": 2, "abre": "08:00", "activo": 1, "cierra": "17:00"}, {"dia": 3, "abre": "08:00", "activo": 1, "cierra": "17:00"}, {"dia": 4, "abre": "08:00", "activo": 1, "cierra": "17:00"}, {"dia": 5, "abre": "08:00", "activo": 1, "cierra": "17:00"}, {"dia": 6, "abre": "08:00", "activo": 1, "cierra": "13:00"}, {"dia": 0, "abre": "08:00", "activo": 0, "cierra": "13:00"}]', '1', '1', '1', '0', '2026-08-13 06:53:36+00', '2', '7', '-6', '30', '[{"valor": "efectivo", "etiqueta": "Efectivo"}, {"valor": "sinpe", "etiqueta": "SINPE Móvil"}, {"valor": "tarjeta", "etiqueta": "Tarjeta"}, {"valor": "transferencia", "etiqueta": "Transferencia"}]', '2', NULL, NULL, '0');
INSERT INTO "motiq_bitacora" ("id", "admin_id", "admin_email", "accion", "tenant_id", "tenant_slug", "detalle", "created_at") VALUES
  ('62', '1', 'jefry@motiq.cr', 'edito_cuenta', NULL, NULL, 'su perfil: nombre, correo', '2026-08-13 02:23:40+00');
SELECT setval(pg_get_serial_sequence('motiq_bitacora', 'id'), (SELECT MAX("id") FROM "motiq_bitacora"));
INSERT INTO "planes_config" ("plan", "precio_mensual", "limite_usuarios", "limite_sucursales", "marca_propia", "reportes_dias", "updated_at") VALUES
  ('gratis', '0', '2', '1', '0', '30', '2026-08-13 02:14:33+00'),
  ('pro', '0', NULL, NULL, '1', NULL, '2026-08-13 02:14:56+00'),
  ('trial', '0', NULL, NULL, '1', NULL, '2026-08-13 02:09:28+00');
INSERT INTO "servicios" ("id", "nombre", "activo", "orden", "created_at", "updated_at", "tenant_id") VALUES
  ('1', 'Cambio de aceite y filtros', '1', '1', '2026-08-11 23:49:09+00', '2026-08-11 23:49:09+00', '1'),
  ('2', 'Revisión completa', '1', '2', '2026-08-11 23:49:09+00', '2026-08-11 23:49:09+00', '1'),
  ('3', 'Cambio de pastillas de freno', '1', '3', '2026-08-11 23:49:09+00', '2026-08-11 23:49:09+00', '1'),
  ('4', 'Kit de transmisión (cadena y piñones)', '1', '4', '2026-08-11 23:49:09+00', '2026-08-11 23:49:09+00', '1'),
  ('5', 'Diagnóstico electrónico', '1', '5', '2026-08-11 23:49:09+00', '2026-08-11 23:49:09+00', '1'),
  ('6', 'Cambio de neumáticos', '1', '6', '2026-08-11 23:49:09+00', '2026-08-11 23:49:09+00', '1'),
  ('7', 'Mantenimiento preventivo', '1', '7', '2026-08-11 23:49:09+00', '2026-08-11 23:49:09+00', '1'),
  ('8', 'Sistema eléctrico', '1', '8', '2026-08-11 23:49:09+00', '2026-08-11 23:49:09+00', '1'),
  ('9', 'Afinamiento', '1', '9', '2026-08-11 23:49:09+00', '2026-08-11 23:49:09+00', '1'),
  ('10', 'Otro', '1', '99', '2026-08-11 23:49:09+00', '2026-08-11 23:49:09+00', '1'),
  ('42', 'Cambio de aceite y filtros', '1', '1', '2026-08-12 02:09:32+00', '2026-08-12 02:09:32+00', '2'),
  ('43', 'Revisión completa', '1', '2', '2026-08-12 02:09:32+00', '2026-08-12 02:09:32+00', '2'),
  ('44', 'Cambio de pastillas de freno', '1', '3', '2026-08-12 02:09:32+00', '2026-08-12 02:09:32+00', '2'),
  ('45', 'Kit de transmisión (cadena y piñones)', '1', '4', '2026-08-12 02:09:32+00', '2026-08-12 02:09:32+00', '2'),
  ('46', 'Diagnóstico electrónico', '1', '5', '2026-08-12 02:09:32+00', '2026-08-12 02:09:32+00', '2'),
  ('47', 'Cambio de neumáticos', '1', '6', '2026-08-12 02:09:32+00', '2026-08-12 02:09:32+00', '2'),
  ('48', 'Mantenimiento preventivo', '1', '7', '2026-08-12 02:09:32+00', '2026-08-12 02:09:32+00', '2'),
  ('49', 'Sistema eléctrico', '1', '8', '2026-08-12 02:09:32+00', '2026-08-12 02:09:32+00', '2'),
  ('50', 'Afinamiento', '1', '9', '2026-08-12 02:09:32+00', '2026-08-12 02:09:32+00', '2'),
  ('51', 'Otro', '1', '99', '2026-08-12 02:09:32+00', '2026-08-12 02:09:32+00', '2');
SELECT setval(pg_get_serial_sequence('servicios', 'id'), (SELECT MAX("id") FROM "servicios"));
INSERT INTO "sucursales" ("id", "nombre", "direccion", "telefono", "activa", "orden", "created_at", "updated_at", "tenant_id") VALUES
  ('1', 'Liberia', NULL, NULL, '1', '1', '2026-08-11 23:48:52+00', '2026-08-11 23:48:52+00', '1'),
  ('2', 'Cañas', NULL, NULL, '1', '2', '2026-08-11 23:48:52+00', '2026-08-11 23:48:52+00', '1');
SELECT setval(pg_get_serial_sequence('sucursales', 'id'), (SELECT MAX("id") FROM "sucursales"));
INSERT INTO "tenants" ("id", "nombre", "slug", "plan", "estado", "created_at", "updated_at", "motivo_estado", "trial_hasta") VALUES
  ('1', 'MS Motors', 'ms-motors', 'pro', 'activo', '2026-08-12 00:29:01+00', '2026-08-13 06:05:46+00', NULL, NULL),
  ('2', 'Moto Zone', 'moto-zone', 'trial', 'activo', '2026-08-12 01:46:08+00', '2026-08-13 06:52:09+00', NULL, NULL);
SELECT setval(pg_get_serial_sequence('tenants', 'id'), (SELECT MAX("id") FROM "tenants"));
INSERT INTO "usuarios" ("id", "nombre", "email", "password_hash", "rol", "telefono", "especialidades", "horario", "sucursal_id", "activo", "created_at", "updated_at", "foto", "totp_secret", "totp_activado", "totp_backup", "totp_ultimo_contador", "tenant_id", "email_verificado") VALUES
  ('1', 'Administrador', 'admin@taller.com', '!sin-password!', 'admin', NULL, NULL, NULL, NULL, '1', '2026-08-11 23:48:53+00', '2026-11-08 20:49:01.71693+00', NULL, NULL, '0', NULL, NULL, '1', '1'),
  ('2', 'Recepción', 'recepcion@taller.com', '!sin-password!', 'recepcion', NULL, NULL, NULL, NULL, '1', '2026-08-11 23:48:53+00', '2026-11-08 20:49:01.774795+00', NULL, NULL, '0', NULL, NULL, '1', '1'),
  ('5', 'Admin Zone', 'admin@taller.com', '!sin-password!', 'admin', NULL, NULL, NULL, NULL, '1', '2026-08-12 01:46:08+00', '2026-11-08 20:49:01.660112+00', NULL, NULL, '0', NULL, NULL, '2', '1');
SELECT setval(pg_get_serial_sequence('usuarios', 'id'), (SELECT MAX("id") FROM "usuarios"));
INSERT INTO "vehiculos" ("id", "cliente_id", "tipo", "marca", "modelo", "anio", "placa", "color", "numero_motor", "numero_chasis", "kilometraje_actual", "foto_url", "activa", "created_at", "updated_at", "foto", "tenant_id", "atributos", "es_ejemplo") VALUES
  ('29', '1', 'moto', 'Honda', 'CB125', NULL, 'ABC-123', NULL, NULL, NULL, '0', NULL, '1', '2026-08-12 17:22:00+00', '2026-08-12 17:22:00+00', NULL, '1', NULL, '0'),
  ('30', '2', 'moto', 'Yamaha', 'FZ', NULL, 'ABC-123', NULL, NULL, NULL, '0', NULL, '1', '2026-08-12 17:22:00+00', '2026-08-12 17:22:00+00', NULL, '2', NULL, '0'),
  ('33', '1', 'moto', 'Honda', 'CB125', NULL, 'A4B-465', NULL, NULL, NULL, '0', NULL, '1', '2026-08-12 17:56:00+00', '2026-08-12 17:56:00+00', NULL, '1', NULL, '0'),
  ('34', '2', 'moto', 'Yamaha', 'FZ', NULL, 'A4B-465', NULL, NULL, NULL, '0', NULL, '1', '2026-08-12 17:56:00+00', '2026-08-12 17:56:00+00', NULL, '2', NULL, '0'),
  ('35', '1', 'moto', 'Honda', 'CB125', NULL, 'A3B-570', NULL, NULL, NULL, '0', NULL, '1', '2026-08-12 18:12:27+00', '2026-08-12 18:12:27+00', NULL, '1', NULL, '0'),
  ('36', '2', 'moto', 'Yamaha', 'FZ', NULL, 'A3B-570', NULL, NULL, NULL, '0', NULL, '1', '2026-08-12 18:12:27+00', '2026-08-12 18:12:27+00', NULL, '2', NULL, '0'),
  ('39', '1', 'moto', 'Honda', 'CB125', NULL, 'A5B-375', NULL, NULL, NULL, '0', NULL, '1', '2026-08-12 19:30:13+00', '2026-08-12 19:30:13+00', NULL, '1', NULL, '0'),
  ('40', '2', 'moto', 'Yamaha', 'FZ', NULL, 'A5B-375', NULL, NULL, NULL, '0', NULL, '1', '2026-08-12 19:30:13+00', '2026-08-12 19:30:13+00', NULL, '2', NULL, '0'),
  ('45', '1', 'moto', 'Honda', 'CB125', NULL, 'A4B-422', NULL, NULL, NULL, '0', NULL, '1', '2026-08-12 22:17:28+00', '2026-08-12 22:17:28+00', NULL, '1', NULL, '0'),
  ('46', '2', 'moto', 'Yamaha', 'FZ', NULL, 'A4B-422', NULL, NULL, NULL, '0', NULL, '1', '2026-08-12 22:17:28+00', '2026-08-12 22:17:28+00', NULL, '2', NULL, '0'),
  ('52', '1', 'moto', 'Honda', 'CB125', NULL, 'A9B-481', NULL, NULL, NULL, '0', NULL, '1', '2026-08-12 23:48:41+00', '2026-08-12 23:48:41+00', NULL, '1', NULL, '0'),
  ('53', '2', 'moto', 'Yamaha', 'FZ', NULL, 'A9B-481', NULL, NULL, NULL, '0', NULL, '1', '2026-08-12 23:48:41+00', '2026-08-12 23:48:41+00', NULL, '2', NULL, '0'),
  ('54', '1', 'moto', 'Honda', 'CB125', NULL, 'A9B-806', NULL, NULL, NULL, '0', NULL, '1', '2026-08-13 00:17:10+00', '2026-08-13 00:17:10+00', NULL, '1', NULL, '0'),
  ('55', '2', 'moto', 'Yamaha', 'FZ', NULL, 'A9B-806', NULL, NULL, NULL, '0', NULL, '1', '2026-08-13 00:17:10+00', '2026-08-13 00:17:10+00', NULL, '2', NULL, '0');
SELECT setval(pg_get_serial_sequence('vehiculos', 'id'), (SELECT MAX("id") FROM "vehiculos"));
COMMIT;
