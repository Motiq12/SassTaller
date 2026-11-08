-- Datos de prueba: los dos talleres del volcado MySQL original.
-- Generado por scripts/convertir-volcado-a-postgres.js. Se carga sobre una base recién
-- migrada (npm run db:importar). Las fechas del volcado están en UTC.

SET TIME ZONE 'UTC';
BEGIN;
SET CONSTRAINTS ALL DEFERRED;

INSERT INTO "citas" ("id", "cliente_id", "vehiculo_id", "usuario_id", "tecnico_id", "sucursal_id", "fecha", "hora", "motivo", "tipo_servicio", "estado", "monto", "calificacion", "comentario_satisfaccion", "fecha_inicio", "fecha_fin", "hora_llegada", "orden_id", "created_at", "updated_at", "confirmada_cliente", "fecha_listo", "recordatorio_enviado", "no_show", "fecha_cancelacion", "tenant_id", "es_ejemplo") VALUES
  (1, 1, NULL, NULL, NULL, 1, '2026-08-20', '09:00:00', 'CITA-DEL-TALLER-1', NULL, 'agendado', 0.00, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-12 01:46:08', '2026-08-12 01:47:06', 0, NULL, 0, 0, NULL, 1, 0),
  (2, 2, NULL, NULL, NULL, 1, '2026-08-20', '10:00:00', 'CITA-DEL-TALLER-2', NULL, 'agendado', 0.00, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-12 01:46:08', '2026-08-12 01:47:06', 0, NULL, 0, 0, NULL, 2, 0);
INSERT INTO "clientes" ("id", "nombre", "apellido", "telefono", "email", "cedula", "direccion", "password_hash", "visitas", "cortesia_disponible", "notif_avances", "notif_recordatorios", "activo", "created_at", "updated_at", "foto", "email_verificado", "email_pendiente", "tenant_id", "es_ejemplo") VALUES
  (1, 'Cliente', 'DelUno', '111-1111', NULL, NULL, NULL, NULL, 0, 0, 1, 1, 1, '2026-08-12 01:46:08', '2026-08-12 01:46:08', NULL, 1, NULL, 1, 0),
  (2, 'Cliente', 'DelDos', '222-2222', NULL, NULL, NULL, NULL, 0, 0, 1, 1, 1, '2026-08-12 01:46:08', '2026-08-12 01:46:08', NULL, 1, NULL, 2, 0),
  (33, 'Ana', 'Uno', '8888-1111', 'cliente-1786557361919@t.com', '1-2222-3333', NULL, '$2b$10$KPp0s9ggMXn4MOjS.WoeQu4u8QEiP5yWCmZxhF1PGLrsVlBDhnlQG', 0, 0, 1, 1, 1, '2026-08-12 17:56:02', '2026-08-12 17:56:02', NULL, 1, NULL, 1, 0),
  (34, 'Ana', 'Dos', '8888-2222', 'cliente-1786557361919@t.com', '1-2222-3333', NULL, '$2b$10$Yg7X/bHUL7tSUtt7YqIE8OU7xMSml.3ZAbeE773KpZW.bOpfld8vG', 0, 0, 1, 1, 1, '2026-08-12 17:56:02', '2026-08-12 17:56:02', NULL, 1, NULL, 2, 0),
  (35, 'Ana', 'Uno', '8888-1111', 'cliente-1786558071993@t.com', '1-2222-3333', NULL, '$2b$10$S5/aBPEfW9FuNSpIPMIsF.E8jGY0x8dOx/Vm6bUBQQFIbDBtCXipu', 0, 0, 1, 1, 1, '2026-08-12 18:07:52', '2026-08-12 18:07:52', NULL, 1, NULL, 1, 0),
  (36, 'Ana', 'Dos', '8888-2222', 'cliente-1786558071993@t.com', '1-2222-3333', NULL, '$2b$10$phw6cBSlWNsUk/GKYOGySu5uYmDVqsuBxV37aGcojWX8qQKjguUtm', 0, 0, 1, 1, 1, '2026-08-12 18:07:52', '2026-08-12 18:07:52', NULL, 1, NULL, 2, 0),
  (37, 'Ana', 'Uno', '8888-1111', 'cliente-1786558348758@t.com', '1-2222-3333', NULL, '$2b$10$WuyqP/mEwJgZUwedinY/DepPLUMYg38gmPK7QKoApuihKbZP82wom', 0, 0, 1, 1, 1, '2026-08-12 18:12:28', '2026-08-12 18:12:29', NULL, 1, NULL, 1, 0),
  (38, 'Ana', 'Dos', '8888-2222', 'cliente-1786558348758@t.com', '1-2222-3333', NULL, '$2b$10$hUPOgPeSMZX.0qD1wxx1e.OTzjgicFU8.0V6.R56gYCN5yGg8Fp5W', 0, 0, 1, 1, 1, '2026-08-12 18:12:28', '2026-08-12 18:12:29', NULL, 1, NULL, 2, 0),
  (40, 'Ana', 'Uno', '8888-1111', 'cliente-1786563032083@t.com', '1-2222-3333', NULL, '$2b$10$LYO49yE7SK6/c1Bqtk56ZOzXs7eOAn6eOmrcRv6am.SvtDn76ArQS', 0, 0, 1, 1, 1, '2026-08-12 19:30:32', '2026-08-12 19:30:32', NULL, 1, NULL, 1, 0),
  (41, 'Ana', 'Dos', '8888-2222', 'cliente-1786563032083@t.com', '1-2222-3333', NULL, '$2b$10$WH.FvMtHKr.dD4TE02ya0eoL0RELLN9sBHxJQeCsghXJT2snLfioO', 0, 0, 1, 1, 1, '2026-08-12 19:30:32', '2026-08-12 19:30:32', NULL, 1, NULL, 2, 0),
  (44, 'Ana', 'Uno', '8888-1111', 'cliente-1786564589328@t.com', '1-2222-3333', NULL, '$2b$10$mJ6lOjunDUGrthYTLXs4CuG9a2FwWVp2z/BJf5QjfUUF41BjASR2m', 0, 0, 1, 1, 1, '2026-08-12 19:56:29', '2026-08-12 19:56:29', NULL, 1, NULL, 1, 0),
  (45, 'Ana', 'Dos', '8888-2222', 'cliente-1786564589328@t.com', '1-2222-3333', NULL, '$2b$10$MHGBN9RF0d6gEDEA7gJJ6ec7tfGd9kZoKBB.XFrE81uJ3fZWEZRqW', 0, 0, 1, 1, 1, '2026-08-12 19:56:29', '2026-08-12 19:56:29', NULL, 1, NULL, 2, 0),
  (46, 'Ana', 'Uno', '8888-1111', 'cliente-1786572350264@t.com', '1-2222-3333', NULL, '$2b$10$.dt0dodyKrEsiLiWOtEuoOF9Z0vIH304L0ABaFzB5FIZ0DQDv9ZD6', 0, 0, 1, 1, 1, '2026-08-12 22:05:50', '2026-08-12 22:05:51', NULL, 1, NULL, 1, 0),
  (47, 'Ana', 'Dos', '8888-2222', 'cliente-1786572350264@t.com', '1-2222-3333', NULL, '$2b$10$60P2lVxGv3ucvd5r/agAw.5oUD2tIWelBFxz5MlyzRR.G3hI2tIm2', 0, 0, 1, 1, 1, '2026-08-12 22:05:50', '2026-08-12 22:05:51', NULL, 1, NULL, 2, 0),
  (48, 'Ana', 'Uno', '8888-1111', 'cliente-1786572579853@t.com', '1-2222-3333', NULL, '$2b$10$Pj9dcMm8Q1dMAqPW2OD54.tg72gtzc47w26hq23cqWjXoNU.B/FgW', 0, 0, 1, 1, 1, '2026-08-12 22:09:39', '2026-08-12 22:09:40', NULL, 1, NULL, 1, 0),
  (49, 'Ana', 'Dos', '8888-2222', 'cliente-1786572579853@t.com', '1-2222-3333', NULL, '$2b$10$hBFbZpfkaAdT4oyWiSVBZubabH6iGeJdwtTQv33rYV12U4NjjWK4m', 0, 0, 1, 1, 1, '2026-08-12 22:09:40', '2026-08-12 22:09:40', NULL, 1, NULL, 2, 0),
  (54, 'Ana', 'Uno', '8888-1111', 'cliente-1786578529261@t.com', '1-2222-3333', NULL, '$2b$10$rldY1ceXNkONHMykq6F.X.u4GrA6SMqTXkaf7kI42REd4RRpRAS2G', 0, 0, 1, 1, 1, '2026-08-12 23:48:49', '2026-08-12 23:48:49', NULL, 1, NULL, 1, 0),
  (55, 'Ana', 'Dos', '8888-2222', 'cliente-1786578529261@t.com', '1-2222-3333', NULL, '$2b$10$5CWt2X1CKOgxd3MDb4e1rO9ctr/gXJx8KTZbad9dQzojigtHwzE4W', 0, 0, 1, 1, 1, '2026-08-12 23:48:49', '2026-08-12 23:48:49', NULL, 1, NULL, 2, 0),
  (56, 'Ana', 'Uno', '8888-1111', 'cliente-1786580238153@t.com', '1-2222-3333', NULL, '$2b$10$JnzvlddvdxlKtGPnNUN11OLRwleLqTjlybDYQ14zEa7ILGkLHHG2a', 0, 0, 1, 1, 1, '2026-08-13 00:17:18', '2026-08-13 00:17:18', NULL, 1, NULL, 1, 0),
  (57, 'Ana', 'Dos', '8888-2222', 'cliente-1786580238153@t.com', '1-2222-3333', NULL, '$2b$10$33l6SQJJRCnr62JdJwsn3ed9HxbLM061YBOmWWluWMlAKZjoKwhES', 0, 0, 1, 1, 1, '2026-08-13 00:17:18', '2026-08-13 00:17:18', NULL, 1, NULL, 2, 0);
INSERT INTO "configuracion" ("id", "nombre_taller", "telefono", "email", "direccion", "logo", "max_citas_hora", "dias_anticipacion", "duracion_cita_min", "horarios", "notif_estado", "notif_recordatorio", "notif_cotizacion", "notif_email_entrega", "updated_at", "cancelacion_horas_min", "visitas_para_cortesia", "zona_horaria_offset", "garantia_dias", "metodos_pago", "tenant_id", "tipos_vehiculo", "color_primario", "arranque_oculto") VALUES
  (1, 'MS Motos', NULL, NULL, NULL, NULL, 2, 30, 90, '[{"dia": 1, "abre": "08:00", "activo": 1, "cierra": "17:00"}, {"dia": 2, "abre": "08:00", "activo": 1, "cierra": "17:00"}, {"dia": 3, "abre": "08:00", "activo": 1, "cierra": "17:00"}, {"dia": 4, "abre": "08:00", "activo": 1, "cierra": "17:00"}, {"dia": 5, "abre": "08:00", "activo": 1, "cierra": "17:00"}, {"dia": 6, "abre": "08:00", "activo": 1, "cierra": "13:00"}, {"dia": 0, "abre": "08:00", "activo": 0, "cierra": "13:00"}]', 1, 1, 1, 0, '2026-08-13 06:06:55', 2, 7, -6, 30, '[{"valor": "efectivo", "etiqueta": "Efectivo"}, {"valor": "sinpe", "etiqueta": "SINPE Móvil"}, {"valor": "tarjeta", "etiqueta": "Tarjeta"}, {"valor": "transferencia", "etiqueta": "Transferencia"}]', 1, '["moto"]', '#e11d48', 0),
  (1, 'Moto Zone', NULL, NULL, NULL, NULL, 2, 30, 90, '[{"dia": 1, "abre": "08:00", "activo": 1, "cierra": "17:00"}, {"dia": 2, "abre": "08:00", "activo": 1, "cierra": "17:00"}, {"dia": 3, "abre": "08:00", "activo": 1, "cierra": "17:00"}, {"dia": 4, "abre": "08:00", "activo": 1, "cierra": "17:00"}, {"dia": 5, "abre": "08:00", "activo": 1, "cierra": "17:00"}, {"dia": 6, "abre": "08:00", "activo": 1, "cierra": "13:00"}, {"dia": 0, "abre": "08:00", "activo": 0, "cierra": "13:00"}]', 1, 1, 1, 0, '2026-08-13 06:53:36', 2, 7, -6, 30, '[{"valor": "efectivo", "etiqueta": "Efectivo"}, {"valor": "sinpe", "etiqueta": "SINPE Móvil"}, {"valor": "tarjeta", "etiqueta": "Tarjeta"}, {"valor": "transferencia", "etiqueta": "Transferencia"}]', 2, NULL, NULL, 0);
INSERT INTO "email_verify_codes" ("id", "cliente_id", "code_hash", "expires_at", "used", "attempts", "created_at", "proposito", "tenant_id") VALUES
  (21, 33, '$2b$10$FQGblzONyjkfhTb9WvpksuKUUuVUg95cnsAdvShCJbZ7crnXDmv3e', '2026-08-12 12:06:02', 0, 0, '2026-08-12 17:56:02', 'registro', 1),
  (22, 34, '$2b$10$NSlpSv84jSxu.ts9vJJR.u3kwQUdBlITJN/6ON2TkRkRrIB7QJFD2', '2026-08-12 12:06:02', 0, 0, '2026-08-12 17:56:02', 'registro', 2),
  (23, 35, '$2b$10$blZvmkInTqi7Xnwp5d4bke2bhMGzA2/vJ6t6CR0B5Yf6BB5.n8OXS', '2026-08-12 12:17:52', 0, 0, '2026-08-12 18:07:52', 'registro', 1),
  (24, 36, '$2b$10$6FaH6R1QvBtSGbdjdhs0meQz.xEET1XdVYsac83rkvjEfg7zttEQm', '2026-08-12 12:17:52', 0, 0, '2026-08-12 18:07:52', 'registro', 2),
  (25, 37, '$2b$10$S8XmNTizBbH3KFzbtSIwPe4qaMmiVk30D0aspmAriD0pQu0yJJxyW', '2026-08-12 12:22:28', 0, 0, '2026-08-12 18:12:28', 'registro', 1),
  (26, 38, '$2b$10$irUwsY1tpbBuZH3thh1s3.pdKeBtGfLTAXE3napvL.Z5wwRoUhzKe', '2026-08-12 12:22:29', 0, 0, '2026-08-12 18:12:29', 'registro', 2),
  (27, 40, '$2b$10$O6y9fAd7JGgszvOly.UIluYNQBey/MxA8fOeQiwvbUt9rv5o4c1Ou', '2026-08-12 13:40:32', 0, 0, '2026-08-12 19:30:32', 'registro', 1),
  (28, 41, '$2b$10$RAYqIWE1gy8nvfOaq8nxZ.zVn.LGNFDgad7Gx1seASuniwTz2vhju', '2026-08-12 13:40:32', 0, 0, '2026-08-12 19:30:32', 'registro', 2),
  (29, 44, '$2b$10$WrchX7x9CdiF8Ofz6lKVWuH2I7HRiI5AAto7ZBObhx2pGCrkmxZVe', '2026-08-12 14:06:29', 0, 0, '2026-08-12 19:56:29', 'registro', 1),
  (30, 45, '$2b$10$MLekTDaV42efvttQHwU5wOJS9p1EIgYatNuU9/ST/7B7RpMEWQdlm', '2026-08-12 14:06:29', 0, 0, '2026-08-12 19:56:29', 'registro', 2),
  (31, 46, '$2b$10$Bw5CQB3nRajnn/Z5NvBQQO4nsN6urnVB5mLpKZCVKxJB/dz7uBG9G', '2026-08-12 16:15:50', 0, 0, '2026-08-12 22:05:50', 'registro', 1),
  (32, 47, '$2b$10$lny23i3LU.IBiIOZx4dc3.9VYDJQyh5nlO0F/GAnUMVpW5eAiJHk.', '2026-08-12 16:15:50', 0, 0, '2026-08-12 22:05:50', 'registro', 2),
  (33, 48, '$2b$10$W0F4B/agb2gPevBthLQZjuT0m4iLzaR8tC3KBwwoj6YF3tGiS2.4W', '2026-08-12 16:19:40', 0, 0, '2026-08-12 22:09:40', 'registro', 1),
  (34, 49, '$2b$10$.3bvHv2UASQk34HWCuQ53.pVV9JtIolX.ZRlMKfqYVfX3/qsk14hu', '2026-08-12 16:19:40', 0, 0, '2026-08-12 22:09:40', 'registro', 2),
  (35, 54, '$2b$10$VjDM5DwYXKXcdAhDuv0S2e3AWIcP51b8FYD7CRVF9VUUi7824xD7C', '2026-08-12 17:58:49', 0, 0, '2026-08-12 23:48:49', 'registro', 1),
  (36, 55, '$2b$10$2hM3cDEBpPFaX2q3a16TA.1Bq9.sppfpjjo2UrhMCmJbFIvVjtwpW', '2026-08-12 17:58:49', 0, 0, '2026-08-12 23:48:49', 'registro', 2),
  (37, 56, '$2b$10$SR.eV6fnUVBPh7AfO9cN6uyY615K8VbNay4K3lslu8m/YBsecFyJy', '2026-08-12 18:27:18', 0, 0, '2026-08-13 00:17:18', 'registro', 1),
  (38, 57, '$2b$10$h5zeAr7fSg51Uv.Og1rETeh.TRnfHm/nvGMSx/hZxmr2O/XFJVe8C', '2026-08-12 18:27:18', 0, 0, '2026-08-13 00:17:18', 'registro', 2);
INSERT INTO "motiq_bitacora" ("id", "admin_id", "admin_email", "accion", "tenant_id", "tenant_slug", "detalle", "created_at") VALUES
  (62, 1, 'jefry@motiq.cr', 'edito_cuenta', NULL, NULL, 'su perfil: nombre, correo', '2026-08-13 02:23:40');
INSERT INTO "planes_config" ("plan", "precio_mensual", "limite_usuarios", "limite_sucursales", "marca_propia", "reportes_dias", "updated_at") VALUES
  ('gratis', 0, 2, 1, 0, 30, '2026-08-13 02:14:33'),
  ('pro', 0, NULL, NULL, 1, NULL, '2026-08-13 02:14:56'),
  ('trial', 0, NULL, NULL, 1, NULL, '2026-08-13 02:09:28');
INSERT INTO "servicios" ("id", "nombre", "activo", "orden", "created_at", "updated_at", "tenant_id") VALUES
  (1, 'Cambio de aceite y filtros', 1, 1, '2026-08-11 23:49:09', '2026-08-11 23:49:09', 1),
  (2, 'Revisión completa', 1, 2, '2026-08-11 23:49:09', '2026-08-11 23:49:09', 1),
  (3, 'Cambio de pastillas de freno', 1, 3, '2026-08-11 23:49:09', '2026-08-11 23:49:09', 1),
  (4, 'Kit de transmisión (cadena y piñones)', 1, 4, '2026-08-11 23:49:09', '2026-08-11 23:49:09', 1),
  (5, 'Diagnóstico electrónico', 1, 5, '2026-08-11 23:49:09', '2026-08-11 23:49:09', 1),
  (6, 'Cambio de neumáticos', 1, 6, '2026-08-11 23:49:09', '2026-08-11 23:49:09', 1),
  (7, 'Mantenimiento preventivo', 1, 7, '2026-08-11 23:49:09', '2026-08-11 23:49:09', 1),
  (8, 'Sistema eléctrico', 1, 8, '2026-08-11 23:49:09', '2026-08-11 23:49:09', 1),
  (9, 'Afinamiento', 1, 9, '2026-08-11 23:49:09', '2026-08-11 23:49:09', 1),
  (10, 'Otro', 1, 99, '2026-08-11 23:49:09', '2026-08-11 23:49:09', 1),
  (42, 'Cambio de aceite y filtros', 1, 1, '2026-08-12 02:09:32', '2026-08-12 02:09:32', 2),
  (43, 'Revisión completa', 1, 2, '2026-08-12 02:09:32', '2026-08-12 02:09:32', 2),
  (44, 'Cambio de pastillas de freno', 1, 3, '2026-08-12 02:09:32', '2026-08-12 02:09:32', 2),
  (45, 'Kit de transmisión (cadena y piñones)', 1, 4, '2026-08-12 02:09:32', '2026-08-12 02:09:32', 2),
  (46, 'Diagnóstico electrónico', 1, 5, '2026-08-12 02:09:32', '2026-08-12 02:09:32', 2),
  (47, 'Cambio de neumáticos', 1, 6, '2026-08-12 02:09:32', '2026-08-12 02:09:32', 2),
  (48, 'Mantenimiento preventivo', 1, 7, '2026-08-12 02:09:32', '2026-08-12 02:09:32', 2),
  (49, 'Sistema eléctrico', 1, 8, '2026-08-12 02:09:32', '2026-08-12 02:09:32', 2),
  (50, 'Afinamiento', 1, 9, '2026-08-12 02:09:32', '2026-08-12 02:09:32', 2),
  (51, 'Otro', 1, 99, '2026-08-12 02:09:32', '2026-08-12 02:09:32', 2);
INSERT INTO "sucursales" ("id", "nombre", "direccion", "telefono", "activa", "orden", "created_at", "updated_at", "tenant_id") VALUES
  (1, 'Liberia', NULL, NULL, 1, 1, '2026-08-11 23:48:52', '2026-08-11 23:48:52', 1),
  (2, 'Cañas', NULL, NULL, 1, 2, '2026-08-11 23:48:52', '2026-08-11 23:48:52', 1);
INSERT INTO "tenants" ("id", "nombre", "slug", "plan", "estado", "created_at", "updated_at", "motivo_estado", "trial_hasta") VALUES
  (1, 'MS Motors', 'ms-motors', 'pro', 'activo', '2026-08-12 00:29:01', '2026-08-13 06:05:46', NULL, NULL),
  (2, 'Moto Zone', 'moto-zone', 'trial', 'activo', '2026-08-12 01:46:08', '2026-08-13 06:52:09', NULL, NULL);
INSERT INTO "usuarios" ("id", "nombre", "email", "password_hash", "rol", "telefono", "especialidades", "horario", "sucursal_id", "activo", "created_at", "updated_at", "foto", "totp_secret", "totp_activado", "totp_backup", "totp_ultimo_contador", "tenant_id", "email_verificado") VALUES
  (1, 'Administrador', 'admin@taller.com', '$2b$10$sFrG6pTctxPrAEbZ.9s6sOAwdddSVgyBTNz7bLW5sY3atgqrMT7h2', 'admin', NULL, NULL, NULL, NULL, 1, '2026-08-11 23:48:53', '2026-08-11 23:48:53', NULL, NULL, 0, NULL, NULL, 1, 1),
  (2, 'Recepción', 'recepcion@taller.com', '$2b$10$zQQc0arTvE19uB5Dgq0.7.rtY4ENRhmtkYbzSwqkQLeZaPwZjhJz6', 'recepcion', NULL, NULL, NULL, NULL, 1, '2026-08-11 23:48:53', '2026-08-11 23:48:53', NULL, NULL, 0, NULL, NULL, 1, 1),
  (5, 'Admin Zone', 'admin@taller.com', '$2b$10$k42ivd3qsBrA0YLrBdPq1ujvtCmJlPrTFmIXtWWlyIPNyQowhPj3e', 'admin', NULL, NULL, NULL, NULL, 1, '2026-08-12 01:46:08', '2026-08-12 01:46:30', NULL, NULL, 0, NULL, NULL, 2, 1);
INSERT INTO "vehiculos" ("id", "cliente_id", "tipo", "marca", "modelo", "anio", "placa", "color", "numero_motor", "numero_chasis", "kilometraje_actual", "foto_url", "activa", "created_at", "updated_at", "foto", "tenant_id", "atributos", "es_ejemplo") VALUES
  (29, 1, 'moto', 'Honda', 'CB125', NULL, 'ABC-123', NULL, NULL, NULL, 0, NULL, 1, '2026-08-12 17:22:00', '2026-08-12 17:22:00', NULL, 1, NULL, 0),
  (30, 2, 'moto', 'Yamaha', 'FZ', NULL, 'ABC-123', NULL, NULL, NULL, 0, NULL, 1, '2026-08-12 17:22:00', '2026-08-12 17:22:00', NULL, 2, NULL, 0),
  (33, 1, 'moto', 'Honda', 'CB125', NULL, 'A4B-465', NULL, NULL, NULL, 0, NULL, 1, '2026-08-12 17:56:00', '2026-08-12 17:56:00', NULL, 1, NULL, 0),
  (34, 2, 'moto', 'Yamaha', 'FZ', NULL, 'A4B-465', NULL, NULL, NULL, 0, NULL, 1, '2026-08-12 17:56:00', '2026-08-12 17:56:00', NULL, 2, NULL, 0),
  (35, 1, 'moto', 'Honda', 'CB125', NULL, 'A3B-570', NULL, NULL, NULL, 0, NULL, 1, '2026-08-12 18:12:27', '2026-08-12 18:12:27', NULL, 1, NULL, 0),
  (36, 2, 'moto', 'Yamaha', 'FZ', NULL, 'A3B-570', NULL, NULL, NULL, 0, NULL, 1, '2026-08-12 18:12:27', '2026-08-12 18:12:27', NULL, 2, NULL, 0),
  (39, 1, 'moto', 'Honda', 'CB125', NULL, 'A5B-375', NULL, NULL, NULL, 0, NULL, 1, '2026-08-12 19:30:13', '2026-08-12 19:30:13', NULL, 1, NULL, 0),
  (40, 2, 'moto', 'Yamaha', 'FZ', NULL, 'A5B-375', NULL, NULL, NULL, 0, NULL, 1, '2026-08-12 19:30:13', '2026-08-12 19:30:13', NULL, 2, NULL, 0),
  (45, 1, 'moto', 'Honda', 'CB125', NULL, 'A4B-422', NULL, NULL, NULL, 0, NULL, 1, '2026-08-12 22:17:28', '2026-08-12 22:17:28', NULL, 1, NULL, 0),
  (46, 2, 'moto', 'Yamaha', 'FZ', NULL, 'A4B-422', NULL, NULL, NULL, 0, NULL, 1, '2026-08-12 22:17:28', '2026-08-12 22:17:28', NULL, 2, NULL, 0),
  (52, 1, 'moto', 'Honda', 'CB125', NULL, 'A9B-481', NULL, NULL, NULL, 0, NULL, 1, '2026-08-12 23:48:41', '2026-08-12 23:48:41', NULL, 1, NULL, 0),
  (53, 2, 'moto', 'Yamaha', 'FZ', NULL, 'A9B-481', NULL, NULL, NULL, 0, NULL, 1, '2026-08-12 23:48:41', '2026-08-12 23:48:41', NULL, 2, NULL, 0),
  (54, 1, 'moto', 'Honda', 'CB125', NULL, 'A9B-806', NULL, NULL, NULL, 0, NULL, 1, '2026-08-13 00:17:10', '2026-08-13 00:17:10', NULL, 1, NULL, 0),
  (55, 2, 'moto', 'Yamaha', 'FZ', NULL, 'A9B-806', NULL, NULL, NULL, 0, NULL, 1, '2026-08-13 00:17:10', '2026-08-13 00:17:10', NULL, 2, NULL, 0);

-- Las identidades siguen después del último id cargado.
SELECT setval(pg_get_serial_sequence('avisos_plataforma', 'id'), COALESCE((SELECT MAX("id") FROM "avisos_plataforma"), 1), (SELECT MAX("id") FROM "avisos_plataforma") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('citas', 'id'), COALESCE((SELECT MAX("id") FROM "citas"), 1), (SELECT MAX("id") FROM "citas") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('clientes', 'id'), COALESCE((SELECT MAX("id") FROM "clientes"), 1), (SELECT MAX("id") FROM "clientes") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('contactos_demo', 'id'), COALESCE((SELECT MAX("id") FROM "contactos_demo"), 1), (SELECT MAX("id") FROM "contactos_demo") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('email_verify_codes', 'id'), COALESCE((SELECT MAX("id") FROM "email_verify_codes"), 1), (SELECT MAX("id") FROM "email_verify_codes") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('garantia_fotos', 'id'), COALESCE((SELECT MAX("id") FROM "garantia_fotos"), 1), (SELECT MAX("id") FROM "garantia_fotos") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('garantias', 'id'), COALESCE((SELECT MAX("id") FROM "garantias"), 1), (SELECT MAX("id") FROM "garantias") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('login_codes', 'id'), COALESCE((SELECT MAX("id") FROM "login_codes"), 1), (SELECT MAX("id") FROM "login_codes") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('mensajes_internos', 'id'), COALESCE((SELECT MAX("id") FROM "mensajes_internos"), 1), (SELECT MAX("id") FROM "mensajes_internos") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('motiq_bitacora', 'id'), COALESCE((SELECT MAX("id") FROM "motiq_bitacora"), 1), (SELECT MAX("id") FROM "motiq_bitacora") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('motiq_tareas', 'id'), COALESCE((SELECT MAX("id") FROM "motiq_tareas"), 1), (SELECT MAX("id") FROM "motiq_tareas") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('notificaciones', 'id'), COALESCE((SELECT MAX("id") FROM "notificaciones"), 1), (SELECT MAX("id") FROM "notificaciones") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('orden_avances', 'id'), COALESCE((SELECT MAX("id") FROM "orden_avances"), 1), (SELECT MAX("id") FROM "orden_avances") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('orden_checklist', 'id'), COALESCE((SELECT MAX("id") FROM "orden_checklist"), 1), (SELECT MAX("id") FROM "orden_checklist") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('orden_fotos', 'id'), COALESCE((SELECT MAX("id") FROM "orden_fotos"), 1), (SELECT MAX("id") FROM "orden_fotos") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('orden_repuestos', 'id'), COALESCE((SELECT MAX("id") FROM "orden_repuestos"), 1), (SELECT MAX("id") FROM "orden_repuestos") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('orden_tiempos', 'id'), COALESCE((SELECT MAX("id") FROM "orden_tiempos"), 1), (SELECT MAX("id") FROM "orden_tiempos") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('ordenes_trabajo', 'id'), COALESCE((SELECT MAX("id") FROM "ordenes_trabajo"), 1), (SELECT MAX("id") FROM "ordenes_trabajo") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('password_reset_codes', 'id'), COALESCE((SELECT MAX("id") FROM "password_reset_codes"), 1), (SELECT MAX("id") FROM "password_reset_codes") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('plataforma_admins', 'id'), COALESCE((SELECT MAX("id") FROM "plataforma_admins"), 1), (SELECT MAX("id") FROM "plataforma_admins") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('promos', 'id'), COALESCE((SELECT MAX("id") FROM "promos"), 1), (SELECT MAX("id") FROM "promos") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('recompensas_canjeadas', 'id'), COALESCE((SELECT MAX("id") FROM "recompensas_canjeadas"), 1), (SELECT MAX("id") FROM "recompensas_canjeadas") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('reportes_falla', 'id'), COALESCE((SELECT MAX("id") FROM "reportes_falla"), 1), (SELECT MAX("id") FROM "reportes_falla") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('servicios', 'id'), COALESCE((SELECT MAX("id") FROM "servicios"), 1), (SELECT MAX("id") FROM "servicios") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('sucursales', 'id'), COALESCE((SELECT MAX("id") FROM "sucursales"), 1), (SELECT MAX("id") FROM "sucursales") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('tareas_mecanico', 'id'), COALESCE((SELECT MAX("id") FROM "tareas_mecanico"), 1), (SELECT MAX("id") FROM "tareas_mecanico") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('tenants', 'id'), COALESCE((SELECT MAX("id") FROM "tenants"), 1), (SELECT MAX("id") FROM "tenants") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('usuario_verify_codes', 'id'), COALESCE((SELECT MAX("id") FROM "usuario_verify_codes"), 1), (SELECT MAX("id") FROM "usuario_verify_codes") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('usuarios', 'id'), COALESCE((SELECT MAX("id") FROM "usuarios"), 1), (SELECT MAX("id") FROM "usuarios") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('vehiculos', 'id'), COALESCE((SELECT MAX("id") FROM "vehiculos"), 1), (SELECT MAX("id") FROM "vehiculos") IS NOT NULL);
SELECT setval(pg_get_serial_sequence('web_vitals', 'id'), COALESCE((SELECT MAX("id") FROM "web_vitals"), 1), (SELECT MAX("id") FROM "web_vitals") IS NOT NULL);
COMMIT;
