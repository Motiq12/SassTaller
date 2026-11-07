// Migraciones idempotentes que corren al arrancar el servidor.
// Seguras de ejecutar en cada deploy: solo aplican el cambio si falta.
const { pool } = require('./pool');
const { ROLES_FABRICA } = require('../utils/permisos');

async function ensureSchema() {
  try {
    // orden_fotos.url debe ser MEDIUMTEXT para guardar imágenes base64 (data URL).
    // En esquemas viejos era VARCHAR(500) y truncaba las fotos.
    const [[col]] = await pool.query(
      `SELECT DATA_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orden_fotos' AND COLUMN_NAME = 'url'`
    );
    if (col && col.DATA_TYPE.toLowerCase() !== 'mediumtext') {
      await pool.query('ALTER TABLE orden_fotos MODIFY COLUMN url MEDIUMTEXT NOT NULL');
      console.log('🔧 Migración: orden_fotos.url → MEDIUMTEXT');
    }

    // Tablas del módulo de garantías (idempotente, no borra datos).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS garantias (
        id                   INT AUTO_INCREMENT PRIMARY KEY,
        orden_id             INT NOT NULL,
        descripcion_problema TEXT NOT NULL,
        cubre_repuestos      TINYINT(1) DEFAULT 0,
        cubre_mano_obra      TINYINT(1) DEFAULT 0,
        estado               ENUM('abierto','en_revision','aprobado','rechazado','resuelto') NOT NULL DEFAULT 'abierto',
        resolucion           TEXT,
        creado_por           INT,
        created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (orden_id)   REFERENCES ordenes_trabajo(id),
        FOREIGN KEY (creado_por) REFERENCES usuarios(id)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS garantia_fotos (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        garantia_id INT NOT NULL,
        url         MEDIUMTEXT NOT NULL,
        descripcion VARCHAR(200),
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (garantia_id) REFERENCES garantias(id)
      )
    `);

    // Portal del cliente: contraseña opcional para acceso al seguimiento.
    await addColumnIfMissing('clientes', 'password_hash', 'VARCHAR(255) NULL');

    // Fotos del portal (data URL base64, igual que orden_fotos/promos): avatar del
    // cliente y foto de cada moto. MEDIUMTEXT aguanta imágenes comprimidas (~16 MB máx).
    await addColumnIfMissing('clientes', 'foto', 'MEDIUMTEXT NULL');
    await addColumnIfMissing('vehiculos', 'foto', 'MEDIUMTEXT NULL');

    // Preferencias de notificación por cliente (el cliente decide si quiere recibirlas).
    // notif_avances: avisos de cambio de estado de sus servicios (aplicado hoy).
    // notif_recordatorios: recordatorio antes de la cita (se persiste; el envío aún no existe).
    await addColumnIfMissing('clientes', 'notif_avances', 'TINYINT(1) NOT NULL DEFAULT 1');
    await addColumnIfMissing('clientes', 'notif_recordatorios', 'TINYINT(1) NOT NULL DEFAULT 1');

    // Códigos de recuperación de contraseña (olvidé mi contraseña) enviados por correo.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_codes (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        cliente_id INT NOT NULL,
        code_hash  VARCHAR(255) NOT NULL,
        expires_at DATETIME NOT NULL,
        used       TINYINT(1) DEFAULT 0,
        attempts   INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_cliente (cliente_id),
        FOREIGN KEY (cliente_id) REFERENCES clientes(id)
      )
    `);

    // Códigos de ingreso sin contraseña (OTP por correo) para el portal del cliente.
    // Misma forma y garantías que password_reset_codes (hash, expiración, intentos,
    // un solo uso), pero en tabla aparte para no interferir con el flujo de reset.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS login_codes (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        cliente_id INT NOT NULL,
        code_hash  VARCHAR(255) NOT NULL,
        expires_at DATETIME NOT NULL,
        used       TINYINT(1) DEFAULT 0,
        attempts   INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_login_cliente (cliente_id),
        FOREIGN KEY (cliente_id) REFERENCES clientes(id)
      )
    `);

    // Verificación de correo al auto-registrarse en el portal (anti-bot: exige probar
    // que se controla la bandeja antes de otorgar sesión). DEFAULT 1: los clientes que
    // ya existían (cargados por el taller, o registrados antes de este cambio) no quedan
    // bloqueados; el registro público es el único camino que arranca en 0.
    await addColumnIfMissing('clientes', 'email_verificado', 'TINYINT(1) NOT NULL DEFAULT 1');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_verify_codes (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        cliente_id INT NOT NULL,
        code_hash  VARCHAR(255) NOT NULL,
        expires_at DATETIME NOT NULL,
        used       TINYINT(1) DEFAULT 0,
        attempts   INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_verify_cliente (cliente_id),
        FOREIGN KEY (cliente_id) REFERENCES clientes(id)
      )
    `);
    // Cambio de correo desde el perfil: la dirección nueva NO reemplaza a la vieja hasta
    // que se confirma. Así un error de tipeo no deja al cliente encerrado afuera — el
    // correo anterior sigue siendo el válido para entrar y para recuperar la contraseña.
    await addColumnIfMissing('clientes', 'email_pendiente', 'VARCHAR(150) NULL');
    // Entrar con Google: la cuenta de Google unida al cliente (el `sub` del token).
    await addColumnIfMissing('clientes', 'google_sub', 'VARCHAR(64) NULL');
    await crearIndiceSiFalta('clientes', 'uq_clientes_google_sub', '(google_sub)', { unico: true });
    // Los códigos de verificación ahora sirven para dos cosas distintas ('registro' y
    // 'cambio'); sin distinguirlas, pedir uno invalidaría el otro.
    await addColumnIfMissing('email_verify_codes', 'proposito', "VARCHAR(20) NOT NULL DEFAULT 'registro'");

    // Aprobación digital del presupuesto por parte del cliente.
    await addColumnIfMissing(
      'ordenes_trabajo', 'aprobacion_cliente',
      "ENUM('pendiente','aprobado','rechazado') NOT NULL DEFAULT 'pendiente'"
    );
    await addColumnIfMissing('ordenes_trabajo', 'motivo_rechazo', 'TEXT NULL');

    // Encuesta de satisfacción del cliente al entregar.
    await addColumnIfMissing('ordenes_trabajo', 'calificacion', 'TINYINT NULL');
    await addColumnIfMissing('ordenes_trabajo', 'comentario_satisfaccion', 'TEXT NULL');

    // Contador atómico por año para numero_orden (evita la condición de carrera de COUNT(*)).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orden_contadores (
        anio   INT PRIMARY KEY,
        ultimo INT NOT NULL DEFAULT 0
      )
    `);
    // Siembra el contador con el último correlativo ya usado por año (idempotente).
    await pool.query(`
      INSERT IGNORE INTO orden_contadores (anio, ultimo)
      SELECT YEAR(created_at), COUNT(*) FROM ordenes_trabajo GROUP BY YEAR(created_at)
    `);

    // Promociones (marketing).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS promos (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        titulo      VARCHAR(150) NOT NULL,
        descripcion TEXT NOT NULL,
        descuento   INT DEFAULT 0,
        activa      TINYINT(1) DEFAULT 1,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Fidelización: visitas del cliente y cortesía disponible cada N entregas.
    await addColumnIfMissing('clientes', 'visitas', 'INT DEFAULT 0');
    await addColumnIfMissing('clientes', 'cortesia_disponible', 'TINYINT(1) DEFAULT 0');
    await addColumnIfMissing('ordenes_trabajo', 'visita_contada', 'TINYINT(1) DEFAULT 0');

    // Historial de cortesías canjeadas: registra cada vez que el taller aplica una
    // cortesía a un cliente (quién, cuándo, sobre qué orden). El cliente lo ve en el portal.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS recompensas_canjeadas (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        cliente_id   INT NOT NULL,
        orden_id     INT NULL,
        aplicado_por INT NULL,
        descripcion  VARCHAR(150) NOT NULL DEFAULT 'Servicio de cortesía',
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_rc_cliente (cliente_id),
        FOREIGN KEY (cliente_id)   REFERENCES clientes(id),
        FOREIGN KEY (aplicado_por) REFERENCES usuarios(id)
      )
    `);

    // Panel del mecánico: la cita es la unidad de trabajo del técnico.
    await addColumnIfMissing('citas', 'tecnico_id', 'INT NULL');
    await addColumnIfMissing('citas', 'tipo_servicio', 'VARCHAR(100) NULL');
    await addColumnIfMissing('citas', 'monto', 'DECIMAL(10,2) DEFAULT 0');
    await addColumnIfMissing('citas', 'calificacion', 'TINYINT NULL');
    await addColumnIfMissing('citas', 'comentario_satisfaccion', 'TEXT NULL');
    await addColumnIfMissing('citas', 'fecha_inicio', 'TIMESTAMP NULL');
    await addColumnIfMissing('citas', 'fecha_fin', 'TIMESTAMP NULL');
    // Forma de pago de una cita sin orden que se entrega en el mostrador (las órdenes
    // ya la guardan en ordenes_trabajo.metodo_pago).
    await addColumnIfMissing('citas', 'metodo_pago', 'VARCHAR(30) NULL');
    // El cliente confirma que asistirá a su cita agendada (señal de no-show para el taller).
    await addColumnIfMissing('citas', 'confirmada_cliente', 'TINYINT(1) DEFAULT 0');
    // Check-in en mostrador: momento en que el cliente llegó al taller (antes de crear la orden).
    await addColumnIfMissing('citas', 'hora_llegada', 'DATETIME NULL');
    await addColumnIfMissing('citas', 'fecha_listo', 'TIMESTAMP NULL');

    // Automatización (jobs programados):
    // recordatorio_enviado: idempotencia del job de recordatorios (1 = ya se avisó de esta cita).
    // no_show: el job diario marca las citas vencidas nunca atendidas (no las cancela ni borra).
    await addColumnIfMissing('citas', 'recordatorio_enviado', 'TINYINT(1) NOT NULL DEFAULT 0');
    await addColumnIfMissing('citas', 'no_show', 'TINYINT(1) NOT NULL DEFAULT 0');
    // Cancelación hecha por el cliente desde el portal: sin esto el taller no se
    // enteraba (la cita simplemente desaparecía de la agenda). Alimenta la alerta
    // 'cita_cancelada' de recepción.
    await addColumnIfMissing('citas', 'fecha_cancelacion', 'DATETIME NULL');

    // Nuevos estados de la cita (flujo que ve el cliente en el portal).
    // Idempotente: solo migra si el enum todavía tiene los estados viejos.
    const [[citaEstado]] = await pool.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'citas' AND COLUMN_NAME = 'estado'`
    );
    if (citaEstado && citaEstado.COLUMN_TYPE.includes('pendiente')) {
      await pool.query('ALTER TABLE citas MODIFY COLUMN estado VARCHAR(20)');
      await pool.query(`
        UPDATE citas SET estado = CASE estado
          WHEN 'pendiente'  THEN 'agendado'
          WHEN 'confirmada' THEN 'agendado'
          WHEN 'completada' THEN 'entregado'
          WHEN 'cancelada'  THEN 'cancelado'
          ELSE estado END
      `);
      await pool.query(`
        ALTER TABLE citas MODIFY COLUMN estado
          ENUM('agendado','en_revision','en_mantenimiento','listo','entregado','cancelado')
          NOT NULL DEFAULT 'agendado'
      `);
      console.log('🔧 Migración: citas.estado → nuevo flujo del mecánico');
    }

    // Portal v2: feed de notificaciones de avance para el cliente.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notificaciones (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        cliente_id INT NOT NULL,
        cita_id    INT,
        titulo     VARCHAR(150) NOT NULL,
        mensaje    VARCHAR(255) NOT NULL,
        leida      TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_cliente (cliente_id),
        FOREIGN KEY (cliente_id) REFERENCES clientes(id),
        FOREIGN KEY (cita_id)    REFERENCES citas(id)
      )
    `);
    // Tipo de evento (icono/color en el portal) e índice para el contador de no leídas.
    await addColumnIfMissing('notificaciones', 'tipo', "VARCHAR(30) NOT NULL DEFAULT 'estado'");
    await crearIndiceSiFalta('notificaciones', 'idx_cliente_leida', '(cliente_id, leida)');

    // Ofertas con imagen (data URL base64).
    await addColumnIfMissing('promos', 'imagen', 'MEDIUMTEXT NULL');
    // Precio final de la oferta (lo fija el admin; opcional, para mostrar en el portal).
    await addColumnIfMissing('promos', 'precio_final', 'INT NULL');

    // Puente cita ↔ orden: una cita puede generar/enlazar una orden de trabajo.
    await addColumnIfMissing('citas', 'orden_id', 'INT NULL');
    await crearIndiceSiFalta('citas', 'idx_citas_orden', '(orden_id)');

    // Índice (fecha,hora) en citas: acelera la disponibilidad y permite que el
    // bloqueo de rango (FOR UPDATE) del control de cupo sea preciso.
    await crearIndiceSiFalta('citas', 'idx_citas_fecha_hora', '(fecha, hora)');

    // Core Web Vitals medidos en los navegadores reales (LCP, CLS, INP, FCP, TTFB).
    // INP solo existe con interacción de una persona: Lighthouse, que corre en
    // laboratorio, no lo reporta. Esta tabla es la única forma de tener ese número.
    // `ruta` se guarda sin querystring para poder agrupar por pantalla.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS web_vitals (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        metrica    VARCHAR(10) NOT NULL,
        valor      DOUBLE NOT NULL,
        calificacion VARCHAR(20),
        ruta       VARCHAR(200) NOT NULL,
        movil      TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_wv_metrica (metrica, created_at),
        INDEX idx_wv_ruta (ruta)
      )
    `);

    // Chat interno: las consultas filtran por el PAR (remitente + destino) y ordenan
    // por fecha, pero la tabla solo tenía índices de una columna, así que MySQL entraba
    // por uno y filtraba y ordenaba el resto en memoria. Van los dos sentidos porque
    // una conversación se busca como A→B y como B→A.
    await crearIndiceSiFalta('mensajes_internos', 'idx_msg_par', '(remitente_id, destino_id, created_at)');
    await crearIndiceSiFalta('mensajes_internos', 'idx_msg_par_inv', '(destino_id, remitente_id, created_at)');
    // Los avisos (broadcast) se filtran por rol y se ordenan por fecha.
    // En una base nueva la columna `tipo` todavía no existe acá (se agrega más abajo,
    // en "Mensajería interna v2"): se intenta sin abortar y se repite después de crearla.
    await tryStep('idx_msg_broadcast', () =>
      crearIndiceSiFalta('mensajes_internos', 'idx_msg_broadcast', '(tipo, destino_rol, created_at)'));

    // Placa única a nivel de base (no solo en la app). Columna generada normalizada
    // (sin espacios/guiones, mayúsculas) + índice único. Se guarda cada paso por
    // separado para que, si hay placas duplicadas heredadas, el índice falle sin
    // abortar el resto de la migración (la validación de la app sigue cubriendo).
    // placa_norm y su índice único los aplica la capa del SaaS (auto-migrate-saas),
    // y allá el índice es (tenant_id, placa_norm). Acá era global, que en multi-taller
    // está mal: dos talleres distintos pueden tener la misma placa y es correcto.

    // Panel del mecánico v2: perfil profesional (lo edita el propio técnico).
    await addColumnIfMissing('usuarios', 'telefono', 'VARCHAR(20) NULL');
    await addColumnIfMissing('usuarios', 'especialidades', 'VARCHAR(300) NULL');
    await addColumnIfMissing('usuarios', 'horario', 'VARCHAR(200) NULL');
    // Foto de perfil del personal (data URL base64, igual que clientes.foto).
    await addColumnIfMissing('usuarios', 'foto', 'MEDIUMTEXT NULL');

    // Verificación en dos pasos (TOTP) del personal. Opt-in por cuenta.
    //  · totp_secret: clave base32 compartida con la app de autenticación. Se guarda
    //    apenas se inicia el alta, pero solo cuenta cuando totp_activado = 1.
    //  · totp_backup: JSON con los hashes bcrypt de los códigos de respaldo (el texto
    //    plano se muestra una única vez al activar y no queda en la base).
    //  · totp_ultimo_contador: último período de 30 s ya consumido — impide reusar el
    //    mismo código dentro de su ventana de validez (anti-replay).
    await addColumnIfMissing('usuarios', 'totp_secret', 'VARCHAR(64) NULL');
    await addColumnIfMissing('usuarios', 'totp_activado', 'TINYINT(1) NOT NULL DEFAULT 0');
    await addColumnIfMissing('usuarios', 'totp_backup', 'TEXT NULL');
    await addColumnIfMissing('usuarios', 'totp_ultimo_contador', 'BIGINT NULL');

    // Tareas del mecánico: checklist propio + asignadas por el admin (Fase C).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tareas_mecanico (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        tecnico_id   INT NOT NULL,
        titulo       VARCHAR(150) NOT NULL,
        detalle      VARCHAR(300),
        prioridad    ENUM('baja','normal','alta','urgente') NOT NULL DEFAULT 'normal',
        hecha        TINYINT(1) DEFAULT 0,
        asignado_por INT,
        vence        DATETIME NULL,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_tarea_tecnico (tecnico_id),
        FOREIGN KEY (tecnico_id)   REFERENCES usuarios(id),
        FOREIGN KEY (asignado_por) REFERENCES usuarios(id)
      )
    `);
    // Fase C en bases existentes: origen (quién la asignó), vencimiento y prioridad ampliada.
    await addColumnIfMissing('tareas_mecanico', 'asignado_por', 'INT NULL');
    await addColumnIfMissing('tareas_mecanico', 'vence', 'DATETIME NULL');
    // Amplía prioridad a 4 niveles conservando los valores viejos (normal/alta), sin perder datos.
    const [[tareaPrio]] = await pool.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tareas_mecanico' AND COLUMN_NAME = 'prioridad'`
    );
    if (tareaPrio && !tareaPrio.COLUMN_TYPE.includes('urgente')) {
      await pool.query(
        "ALTER TABLE tareas_mecanico MODIFY COLUMN prioridad ENUM('baja','normal','alta','urgente') NOT NULL DEFAULT 'normal'"
      );
      console.log('🔧 Migración: tareas_mecanico.prioridad → 4 niveles');
    }

    // Roles simplificados: se eliminan jefe_taller y gerencia (todo se consolida en admin).
    // 1) Remapear usuarios existentes ANTES de achicar el enum (para no perder filas).
    await tryStep('remap roles a admin', () =>
      pool.query("UPDATE usuarios SET rol = 'admin' WHERE rol IN ('jefe_taller', 'gerencia')")
    );
    // 2) Achicar el enum solo si todavía tiene los valores viejos (idempotente).
    const [[rolCol]] = await pool.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'rol'`
    );
    if (rolCol && (rolCol.COLUMN_TYPE.includes('jefe_taller') || rolCol.COLUMN_TYPE.includes('gerencia'))) {
      await tryStep('achicar enum rol', async () => {
        await pool.query(
          "ALTER TABLE usuarios MODIFY COLUMN rol ENUM('recepcion','tecnico','admin') NOT NULL DEFAULT 'tecnico'"
        );
        console.log('🔧 Migración: roles → recepcion/tecnico/admin');
      });
    }

    // Mensajería interna mecánico ↔ recepción.
    // destino_rol agrupa por rol (p. ej. mensaje "a recepción"); destino_id apunta
    // a un usuario puntual (p. ej. la respuesta de recepción a un técnico).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mensajes_internos (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        remitente_id INT NOT NULL,
        destino_rol VARCHAR(20),
        destino_id  INT,
        mensaje     VARCHAR(500) NOT NULL,
        leido       TINYINT(1) DEFAULT 0,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_msg_remitente (remitente_id),
        INDEX idx_msg_destino (destino_id),
        FOREIGN KEY (remitente_id) REFERENCES usuarios(id),
        FOREIGN KEY (destino_id)   REFERENCES usuarios(id)
      )
    `);

    // Configuración del taller (fila única id=1): datos del negocio, horarios de
    // atención, capacidad de la agenda y preferencias de notificación. El portal
    // lee de aquí los cupos/horas (antes hardcodeados en utils/servicios.js).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS configuracion (
        id                  TINYINT PRIMARY KEY,
        nombre_taller       VARCHAR(150),
        telefono            VARCHAR(40),
        email               VARCHAR(120),
        direccion           VARCHAR(200),
        logo                LONGTEXT,
        max_citas_hora      INT DEFAULT 2,
        dias_anticipacion   INT DEFAULT 30,
        duracion_cita_min   INT DEFAULT 90,
        horarios            JSON,
        notif_estado        TINYINT(1) DEFAULT 1,
        notif_recordatorio  TINYINT(1) DEFAULT 1,
        notif_cotizacion    TINYINT(1) DEFAULT 1,
        notif_email_entrega TINYINT(1) DEFAULT 0,
        updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    // Ventana mínima (horas) para que el cliente cancele/reprograme su cita.
    await addColumnIfMissing('configuracion', 'cancelacion_horas_min', 'INT DEFAULT 2');
    await addColumnIfMissing('configuracion', 'visitas_para_cortesia', 'INT DEFAULT 7');
    await addColumnIfMissing('configuracion', 'zona_horaria_offset', 'INT DEFAULT -6');
    // Garantía por defecto al entregar (antes fija en 30 dentro del frontend).
    await addColumnIfMissing('configuracion', 'garantia_dias', 'INT DEFAULT 30');
    // Formas de pago del cierre de orden. JSON [{valor, etiqueta}]; NULL = las de fábrica.
    await addColumnIfMissing('configuracion', 'metodos_pago', 'JSON NULL');
    // Datos de facturación: van en el encabezado y el pie del comprobante de la orden.
    await addColumnIfMissing('configuracion', 'razon_social', 'VARCHAR(150) NULL');
    await addColumnIfMissing('configuracion', 'cedula_juridica', 'VARCHAR(30) NULL');
    await addColumnIfMissing('configuracion', 'nota_factura', 'VARCHAR(300) NULL');
    // Contraseñas del personal (utils/contrasena.js): largo mínimo y si piden letras y números.
    await addColumnIfMissing('configuracion', 'pass_min_largo', 'TINYINT UNSIGNED DEFAULT 8');
    await addColumnIfMissing('configuracion', 'pass_variedad', 'TINYINT(1) DEFAULT 0');
    // Mensajes al cliente reescritos por el taller (utils/plantillas.js). NULL = los de fábrica.
    await addColumnIfMissing('configuracion', 'plantillas', 'JSON NULL');
    // Textos del portal que escribe el taller (utils/textos-portal.js). NULL = los de fábrica.
    await addColumnIfMissing('configuracion', 'portal_textos', 'JSON NULL');
    // Siembra la fila única con valores por defecto (idempotente: INSERT IGNORE).
    // Horarios: 0=Dom … 6=Sáb. L-V 08-17, Sáb 08-13, Dom cerrado.
    await tryStep('seed configuracion', () =>
      pool.query(
        `INSERT IGNORE INTO configuracion
           (id, nombre_taller, telefono, email, direccion,
            max_citas_hora, dias_anticipacion, duracion_cita_min, horarios)
         VALUES (1, 'MS Motos', '', '', '', 2, 30, 90, ?)`,
        [JSON.stringify([
          { dia: 0, abre: '08:00', cierra: '13:00', activo: 0 },
          { dia: 1, abre: '08:00', cierra: '17:00', activo: 1 },
          { dia: 2, abre: '08:00', cierra: '17:00', activo: 1 },
          { dia: 3, abre: '08:00', cierra: '17:00', activo: 1 },
          { dia: 4, abre: '08:00', cierra: '17:00', activo: 1 },
          { dia: 5, abre: '08:00', cierra: '17:00', activo: 1 },
          { dia: 6, abre: '08:00', cierra: '13:00', activo: 1 },
        ])]
      )
    );

    // Sucursales (locales del taller). El sistema pasa de single-local a multi-local:
    // la cita, la orden y el personal se asocian a una sucursal. Se siembran Liberia y
    // Cañas con ids fijos para poder rellenar los datos viejos de forma determinista.
    // Orden importante: crear+sembrar la tabla ANTES de las columnas y el backfill.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sucursales (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        nombre     VARCHAR(100) NOT NULL,
        direccion  VARCHAR(200),
        telefono   VARCHAR(40),
        activa     TINYINT(1) DEFAULT 1,
        orden      INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await tryStep('seed sucursales', () =>
      pool.query("INSERT IGNORE INTO sucursales (id, nombre, orden) VALUES (1, 'Liberia', 1), (2, 'Cañas', 2)")
    );

    // Catálogo de servicios editable desde el panel. Antes vivía hardcodeado en
    // utils/servicios.js (portal) y, con otros nombres, en el formulario de recepción.
    // `citas.tipo_servicio` sigue guardando el TEXTO, no un id: así renombrar o borrar
    // un servicio no reescribe ni rompe el historial ya agendado.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS servicios (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        nombre     VARCHAR(120) NOT NULL,
        activo     TINYINT(1) NOT NULL DEFAULT 1,
        orden      INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_servicio_nombre (nombre)
      )
    `);
    // Semilla con los dos catálogos que estaban dispersos, unificados. Sin esto, al
    // desplegar el portal se quedaría sin nada que ofrecer.
    // Solo con la tabla vacía (una base nueva). Antes corría en cada arranque y,
    // como compara por nombre, si el taller renombraba un servicio de fábrica
    // ("Afinamiento" → "Afinado") el próximo despliegue volvía a crear el nombre
    // viejo y quedaban los dos. Lo mismo con los nombres de citas viejas.
    const [[{ nServicios }]] = await pool.query('SELECT COUNT(*) AS nServicios FROM servicios');
    if (!Number(nServicios)) {
      await tryStep('seed servicios', () =>
        pool.query(
          `INSERT IGNORE INTO servicios (nombre, orden) VALUES
             ('Cambio de aceite y filtros', 1),
             ('Revisión completa', 2),
             ('Cambio de pastillas de freno', 3),
             ('Kit de transmisión (cadena y piñones)', 4),
             ('Diagnóstico electrónico', 5),
             ('Cambio de neumáticos', 6),
             ('Mantenimiento preventivo', 7),
             ('Sistema eléctrico', 8),
             ('Afinamiento', 9),
             ('Otro', 99)`
        )
      );
      // Los servicios que ya se usaron en citas pero no están en la semilla (nombres
      // viejos del formulario de recepción) se incorporan para no perder trazabilidad.
      await tryStep('incorporar servicios historicos', () =>
        pool.query(
          `INSERT IGNORE INTO servicios (nombre, orden)
           SELECT DISTINCT TRIM(tipo_servicio), 50 FROM citas
           WHERE tipo_servicio IS NOT NULL AND TRIM(tipo_servicio) <> ''`
        )
      );
    }

    // Columna sucursal_id (sin FK aquí, igual que citas.tecnico_id/orden_id; las FK van
    // solo en schema.sql para instalación limpia). NULL en usuarios = "atiende ambas".
    await addColumnIfMissing('citas', 'sucursal_id', 'INT NULL');
    await addColumnIfMissing('ordenes_trabajo', 'sucursal_id', 'INT NULL');
    await addColumnIfMissing('usuarios', 'sucursal_id', 'INT NULL');
    // Backfill: las citas y órdenes históricas quedan en Liberia (id=1).
    await tryStep('backfill citas.sucursal_id', () =>
      pool.query('UPDATE citas SET sucursal_id = 1 WHERE sucursal_id IS NULL')
    );
    await tryStep('backfill ordenes.sucursal_id', () =>
      pool.query('UPDATE ordenes_trabajo SET sucursal_id = 1 WHERE sucursal_id IS NULL')
    );
    // Índice por (sucursal, fecha, hora): hace preciso el bloqueo FOR UPDATE del cupo por local.
    await crearIndiceSiFalta('citas', 'idx_citas_sucursal_fecha_hora', '(sucursal_id, fecha, hora)');

    // Repuestos: agregar estado 'solicitado' para que el mecánico pida piezas sin precio.
    const [[repEstado]] = await pool.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orden_repuestos' AND COLUMN_NAME = 'estado'`
    );
    if (repEstado && !repEstado.COLUMN_TYPE.includes('solicitado')) {
      await pool.query(
        "ALTER TABLE orden_repuestos MODIFY COLUMN estado ENUM('disponible','pendiente','pedido_especial','solicitado') DEFAULT 'pendiente'"
      );
      console.log('🔧 Migración: orden_repuestos.estado → +solicitado');
    }

    // Adicionales: cuánto aprobó el cliente, para volver a pedirle aprobación si la
    // cuenta sube con el trabajo ya en marcha, y qué repuestos se sumaron después.
    // Las órdenes que ya estaban aprobadas toman como aprobado el total que tienen hoy.
    const [[conTotalAprobado]] = await pool.query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ordenes_trabajo' AND COLUMN_NAME = 'total_aprobado'`
    );
    await addColumnIfMissing('ordenes_trabajo', 'total_aprobado', 'DECIMAL(10,2) NULL');
    if (!conTotalAprobado.n) {
      await pool.query(
        "UPDATE ordenes_trabajo SET total_aprobado = costo_mano_obra + costo_repuestos - descuento WHERE aprobacion_cliente = 'aprobado'"
      );
    }
    await addColumnIfMissing('orden_repuestos', 'adicional', 'TINYINT(1) NOT NULL DEFAULT 0');

    // Mensajería interna v2: foto, vínculo a orden y soporte de broadcast.
    await addColumnIfMissing('mensajes_internos', 'foto', 'MEDIUMTEXT NULL');
    await addColumnIfMissing('mensajes_internos', 'orden_id', 'INT NULL');
    await addColumnIfMissing('mensajes_internos', 'tipo', "VARCHAR(20) NOT NULL DEFAULT 'directo'");
    await crearIndiceSiFalta('mensajes_internos', 'idx_msg_broadcast', '(tipo, destino_rol, created_at)');

    // Mensajería interna v3: sucursal (para filtrar por sede) y lectura POR USUARIO.
    // Antes `leido` era global por mensaje: al abrir la bandeja se marcaba leído para
    // todo el rol, así que el badge de "no leído" no era confiable entre personas.
    await addColumnIfMissing('mensajes_internos', 'sucursal_id', 'INT NULL');
    await crearIndiceSiFalta('mensajes_internos', 'idx_msg_sucursal', '(sucursal_id)');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mensaje_lecturas (
        mensaje_id INT NOT NULL,
        usuario_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (mensaje_id, usuario_id),
        INDEX idx_ml_usuario (usuario_id)
      )`);

    // Mensajería v4 (chat 1:1 estilo WhatsApp): índices para leer hilos por par
    // de usuarios y bandejas por destinatario sin escanear la tabla.
    await crearIndiceSiFalta('mensajes_internos', 'idx_msg_par', '(remitente_id, destino_id, created_at)');
    await crearIndiceSiFalta('mensajes_internos', 'idx_msg_destino_created', '(destino_id, created_at)');

    // El listado de clientes filtra por activo y ordena por nombre/apellido: sin este
    // índice MySQL escanea la tabla entera y hace filesort en cada carga del módulo.
    await crearIndiceSiFalta('clientes', 'idx_clientes_activo_nombre', '(activo, nombre, apellido)');

    // FK constraints en columnas agregadas por addColumnIfMissing (integridad referencial).
    await tryStep('fk citas.tecnico_id', () => addFkIfMissing('citas', 'fk_citas_tecnico', 'tecnico_id', 'usuarios', 'id'));
    await tryStep('fk citas.orden_id', () => addFkIfMissing('citas', 'fk_citas_orden', 'orden_id', 'ordenes_trabajo', 'id'));
    await tryStep('fk citas.sucursal_id', () => addFkIfMissing('citas', 'fk_citas_sucursal', 'sucursal_id', 'sucursales', 'id'));
    await tryStep('fk ordenes.sucursal_id', () => addFkIfMissing('ordenes_trabajo', 'fk_ordenes_sucursal', 'sucursal_id', 'sucursales', 'id'));
    await tryStep('fk usuarios.sucursal_id', () => addFkIfMissing('usuarios', 'fk_usuarios_sucursal', 'sucursal_id', 'sucursales', 'id'));

    // El cliente solo ve CITAS en el portal (el avance de la orden se le muestra dentro
    // de su cita). Una orden abierta sin cita (cliente que llegó sin agendar, u orden
    // creada en administración) no le aparecía. Ahora toda orden tiene su cita:
    // creada_por_orden = 1 marca las que se crearon solas para eso, y se borran junto
    // con la orden si esta se elimina.
    await addColumnIfMissing('citas', 'creada_por_orden', 'TINYINT(1) NOT NULL DEFAULT 0');
    await tryStep('citas para órdenes sin cita', citasParaOrdenesSinCita);

    // Roles del personal con sus casillas (utils/permisos.js). Los cuatro de fábrica se
    // crean una vez con lo que cada rol podía hacer antes; si ya están, no se tocan
    // (más adelante se podrán editar desde el panel).
    // La pantalla de roles compara usuarios.rol con roles.clave, y MySQL no compara
    // textos de dos collations distintas ("Illegal mix of collations"). Por eso la
    // tabla no fija una: se crea con la de la base y después se iguala a la que tenga
    // usuarios.rol (ver igualarColacionDeRoles). Fijar utf8mb4_unicode_ci servía en una
    // base local, pero en producción usuarios usa utf8mb4_0900_ai_ci y la pantalla
    // Equipo → Roles fallaba.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        clave VARCHAR(30) NULL,
        nombre VARCHAR(60) NOT NULL,
        base ENUM('administracion','mostrador','taller','web') NOT NULL,
        descripcion VARCHAR(200) NULL,
        permisos TEXT NULL,
        de_fabrica TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_roles_clave (clave)
      ) DEFAULT CHARSET=utf8mb4`);
    await tryStep('roles: misma collation que usuarios', igualarColacionDeRoles);
    // El rol propio de cada empleado (roles.id). NULL = el de fábrica de su usuarios.rol.
    // Sin clave foránea a propósito: si se borra un rol, quien lo tenía vuelve solo al de
    // fábrica (middleware/permisos.js), en vez de trabarse el borrado.
    await addColumnIfMissing('usuarios', 'rol_id', 'INT NULL');
    // Seguridad del personal (utils/sesiones.js): los tokens firmados antes de este
    // momento (ms) ya no valen; y cuándo entró por última vez.
    await addColumnIfMissing('usuarios', 'sesiones_desde_ms', 'BIGINT NULL');
    await addColumnIfMissing('usuarios', 'ultimo_ingreso', 'TIMESTAMP NULL');
    for (const r of ROLES_FABRICA) {
      await pool.query(
        'INSERT IGNORE INTO roles (clave, nombre, base, descripcion, permisos, de_fabrica) VALUES (?, ?, ?, ?, ?, 1)',
        [r.clave, r.nombre, r.base, r.descripcion, JSON.stringify(r.permisos)]
      );
    }

    // Registro de cada respaldo de la base (Configuración → Respaldos): cuándo, si
    // salió bien y qué tenía. Se guardan los últimos 200 (jobs/respaldo.js).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS respaldos_registro (
        id INT AUTO_INCREMENT PRIMARY KEY,
        origen ENUM('automatico','panel') NOT NULL DEFAULT 'automatico',
        ok TINYINT(1) NOT NULL,
        clave VARCHAR(255) NULL,
        bytes BIGINT NULL,
        tablas INT NULL,
        filas INT NULL,
        segundos INT NULL,
        cifrado TINYINT(1) NULL,
        error VARCHAR(500) NULL,
        usuario_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) DEFAULT CHARSET=utf8mb4`);

    // Duración de la cita en horas (la cambia administración): ocupa su lugar en cada
    // hora que dura. 24 = todo el día (hasta el cierre). Ver utils/agenda.js.
    await addColumnIfMissing('citas', 'duracion_horas', 'TINYINT UNSIGNED NOT NULL DEFAULT 1');

    // Horas o días bloqueados por administración: no se ofrecen para agendar.
    // Sin sucursal = las dos sedes; sin horas = el día entero.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bloqueos_horario (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sucursal_id INT NULL,
        fecha_desde DATE NOT NULL,
        fecha_hasta DATE NOT NULL,
        hora_desde TIME NULL,
        hora_hasta TIME NULL,
        motivo VARCHAR(150) NOT NULL,
        creado_por INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_bloqueos_fechas (fecha_desde, fecha_hasta)
      )`);

    // Feriados que se repiten todos los años (mes y día): la agenda los bloquea enteros.
    // Sin sucursal = todas las sedes. Ver utils/feriados.js.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS feriados (
        id INT AUTO_INCREMENT PRIMARY KEY,
        mes TINYINT UNSIGNED NOT NULL,
        dia TINYINT UNSIGNED NOT NULL,
        nombre VARCHAR(80) NOT NULL,
        sucursal_id INT NULL,
        creado_por INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_feriados_fecha (mes, dia)
      ) DEFAULT CHARSET=utf8mb4`);

    // Órdenes eliminadas: quién, cuándo y por qué, con una copia de lo principal
    // (la orden y lo que colgaba de ella se borran de verdad).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ordenes_eliminadas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        orden_id INT NOT NULL,
        numero_orden VARCHAR(30) NOT NULL,
        estado VARCHAR(30) NOT NULL,
        cliente_id INT NULL,
        cliente_nombre VARCHAR(200) NULL,
        moto VARCHAR(200) NULL,
        problema_reportado TEXT NULL,
        total DECIMAL(10,2) NOT NULL DEFAULT 0,
        fecha_ingreso DATETIME NULL,
        motivo VARCHAR(500) NOT NULL,
        eliminada_por INT NULL,
        eliminada_por_nombre VARCHAR(150) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_oe_created (created_at)
      )`);

    // Mi perfil del personal: preferencias propias (pantalla de inicio, sede, avisos
    // que no quiere ver) y la firma que sale en las facturas que emite.
    await addColumnIfMissing('usuarios', 'preferencias', 'TEXT NULL');
    await addColumnIfMissing('usuarios', 'firma', 'MEDIUMTEXT NULL');
    // Cada ingreso del personal es una sesión con su dispositivo (utils/sesiones.js):
    // la persona ve dónde está conectada y puede cerrar una sola.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sesiones_personal (
        id INT AUTO_INCREMENT PRIMARY KEY,
        usuario_id INT NOT NULL,
        sid CHAR(32) NOT NULL,
        agente VARCHAR(255) NULL,
        ip VARCHAR(64) NULL,
        creada TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ultima_vez TIMESTAMP NULL,
        vence TIMESTAMP NULL,
        cerrada TIMESTAMP NULL,
        UNIQUE KEY uq_sesiones_sid (sid),
        INDEX idx_sesiones_usuario (usuario_id)
      ) DEFAULT CHARSET=utf8mb4`);
    // Lo que cada quien hizo con su cuenta (ingresos, contraseña, dos pasos, sesiones).
    // El resto de "Mi actividad" sale de las tablas que ya guardan quién hizo qué.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS actividad_personal (
        id INT AUTO_INCREMENT PRIMARY KEY,
        usuario_id INT NOT NULL,
        accion VARCHAR(40) NOT NULL,
        detalle VARCHAR(300) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_actividad_usuario (usuario_id, created_at)
      ) DEFAULT CHARSET=utf8mb4`);
  } catch (err) {
    console.error('⚠️  Auto-migración falló:', err.code || err.message);
  }
  // Va aparte, fuera del try de arriba: si algún paso viejo falla, las tablas del
  // sitio web se crean igual (sin ellas, la sección "Sitio web" del panel no anda).
  await ensureSchemaSitioWeb();
}

// Le crea su cita a cada orden que no tiene (ver arriba). Idempotente: solo toca
// órdenes sin cita, y no las canceladas (el portal no muestra las citas canceladas).
// La fecha y la hora de la cita son las de ingreso de la orden, en la hora del taller:
// se calculan desde UNIX_TIMESTAMP para no depender de la zona de la sesión de MySQL.
// Deja la tabla roles con la misma collation que usuarios.rol, para poder comparar
// usuarios.rol con roles.clave. Solo hace algo si son distintas, así que en cada
// arranque normal no toca nada. La tabla tiene cuatro filas: convertirla es instantáneo.
async function igualarColacionDeRoles() {
  const colacionDe = async (tabla, columna) => {
    const [[fila]] = await pool.query(
      `SELECT COLLATION_NAME AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [tabla, columna]
    );
    return fila && fila.c;
  };
  const deseada = await colacionDe('usuarios', 'rol');
  const actual = await colacionDe('roles', 'clave');
  // El nombre viene de information_schema, no del usuario; igual se valida antes de
  // ponerlo en el SQL, porque no puede ir como parámetro.
  if (!deseada || !actual || deseada === actual || !/^utf8mb4_[a-z0-9_]+$/.test(deseada)) return;
  await pool.query(`ALTER TABLE roles CONVERT TO CHARACTER SET utf8mb4 COLLATE ${deseada}`);
  console.log(`🔧 Migración: roles pasa de ${actual} a ${deseada} (la de usuarios.rol)`);
}

async function citasParaOrdenesSinCita() {
  const [[cfg]] = await pool.query('SELECT zona_horaria_offset FROM configuracion LIMIT 1');
  const offset = Number(cfg?.zona_horaria_offset) || -6;
  const local = `DATE_ADD('1970-01-01 00:00:00', INTERVAL (UNIX_TIMESTAMP(o.fecha_ingreso) + ${offset * 3600}) SECOND)`;
  const [r] = await pool.query(`
    INSERT INTO citas (cliente_id, vehiculo_id, usuario_id, tecnico_id, sucursal_id, fecha, hora, motivo, tipo_servicio,
                       estado, monto, fecha_inicio, fecha_listo, fecha_fin, hora_llegada, orden_id, creada_por_orden)
    SELECT o.cliente_id, o.vehiculo_id, o.recepcionista_id, o.tecnico_id, o.sucursal_id,
           DATE(${local}), TIME(${local}), o.problema_reportado, NULL,
           CASE o.estado WHEN 'recepcion' THEN 'en_revision' WHEN 'diagnostico' THEN 'en_revision'
             WHEN 'esperando_aprobacion' THEN 'en_revision' WHEN 'esperando_repuestos' THEN 'en_revision'
             WHEN 'en_reparacion' THEN 'en_mantenimiento' WHEN 'lista_entrega' THEN 'listo'
             ELSE 'entregado' END,
           IF(o.estado = 'entregada', o.costo_mano_obra + o.costo_repuestos - o.descuento, 0),
           o.fecha_ingreso,
           IF(o.estado IN ('lista_entrega', 'entregada'), COALESCE(o.fecha_entrega_real, o.updated_at), NULL),
           IF(o.estado = 'entregada', COALESCE(o.fecha_entrega_real, o.updated_at), NULL),
           o.fecha_ingreso, o.id, 1
    FROM ordenes_trabajo o
    WHERE o.estado <> 'cancelada'
      AND NOT EXISTS (SELECT 1 FROM citas c WHERE c.orden_id = o.id)`);
  if (r.affectedRows) console.log(`🔧 Migración: ${r.affectedRows} cita(s) creadas para órdenes sin cita`);
}

async function ensureSchemaSitioWeb() {
  // ── Administración del sitio web (msmotors-web) ──
  // El contenido del sitio (catálogo de motos, promoción) se edita desde el panel
  // y vive aquí. Cada "Publicar" guarda una foto completa del contenido en
  // web_publicaciones, que es lo único que lee el sitio al construirse: lo que se
  // edita y todavía no se publicó queda como pendiente, sin llegar al público.
  await tryStep('sitio web: rol contenido', async () => {
    const [[col]] = await pool.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'rol'`
    );
    if (col && !col.COLUMN_TYPE.includes('contenido')) {
      await pool.query(
        "ALTER TABLE usuarios MODIFY COLUMN rol ENUM('recepcion','tecnico','admin','contenido') NOT NULL DEFAULT 'tecnico'"
      );
      console.log('🔧 Migración: usuarios.rol → +contenido');
    }
  });
  // Qué apartados del sitio web puede tocar un empleado que no es admin (JSON).
  await tryStep('sitio web: permisos', () => addColumnIfMissing('usuarios', 'permisos_web', 'TEXT NULL'));
  // Sin FK a usuarios en estas tablas, a propósito: borrar a un empleado no debe
  // trabarse por haber editado el sitio, y el historial guarda su nombre aparte.
  await tryStep('sitio web: tablas', async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS web_motos (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        slug         VARCHAR(80)  NOT NULL,
        nombre       VARCHAR(120) NOT NULL,
        tipo         VARCHAR(30)  NOT NULL,
        estado       ENUM('nueva','usada') NOT NULL DEFAULT 'nueva',
        precio       DECIMAL(12,2) NULL,
        moneda       ENUM('CRC','USD') NOT NULL DEFAULT 'CRC',
        resumen      VARCHAR(200) NULL,
        descripcion  TEXT NULL,
        foto         VARCHAR(500) NULL,
        foto_alt     VARCHAR(200) NULL,
        specs        TEXT NULL,
        stock        TEXT NULL,
        ingreso      DATE NULL,
        orden        INT NOT NULL DEFAULT 0,
        visible      TINYINT(1) NOT NULL DEFAULT 1,
        updated_by   INT NULL,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_web_motos_slug (slug)
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS web_ajustes (
        clave       VARCHAR(50) PRIMARY KEY,
        valor       MEDIUMTEXT NULL,
        updated_by  INT NULL,
        updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS web_publicaciones (
        id             INT AUTO_INCREMENT PRIMARY KEY,
        contenido      MEDIUMTEXT NOT NULL,
        publicado_por  INT NULL,
        publicado_por_nombre VARCHAR(100) NULL,
        created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS web_historial (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        usuario_id      INT NULL,
        usuario_nombre  VARCHAR(100) NULL,
        accion          VARCHAR(30)  NOT NULL,
        entidad         VARCHAR(30)  NOT NULL,
        entidad_id      INT NULL,
        descripcion     VARCHAR(500) NOT NULL,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_web_historial_fecha (created_at)
      )`);
  });

  // v2: varias fotos por moto (lista de direcciones; la primera es la principal).
  await tryStep('sitio web: fotos por moto', () => addColumnIfMissing('web_motos', 'fotos', 'TEXT NULL'));
  // Fotos subidas desde el panel. Se guardan en la base (ya achicadas en el
  // teléfono, ~200 KB) y se sirven aparte en /api/sitio/fotos/:id, con caché
  // larga: nunca viajan dentro de un listado.
  await tryStep('sitio web: tabla de fotos', () => pool.query(`
    CREATE TABLE IF NOT EXISTS web_fotos (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      clave       CHAR(24) NOT NULL,
      mime        VARCHAR(30) NOT NULL,
      ancho       INT NULL,
      alto        INT NULL,
      bytes       MEDIUMBLOB NOT NULL,
      subida_por  INT NULL,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_web_fotos_clave (clave)
    )`));
  // Lo que la gente pide desde el sitio (cotizar una moto, contacto, repuestos).
  // Antes el formulario iba a un correo que nunca se configuró: no le llegaba a nadie.
  await tryStep('sitio web: consultas', () => pool.query(`
    CREATE TABLE IF NOT EXISTS web_consultas (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      tipo           VARCHAR(20)  NOT NULL DEFAULT 'cotizacion',
      nombre         VARCHAR(100) NOT NULL,
      telefono       VARCHAR(30)  NULL,
      email          VARCHAR(150) NULL,
      moto           VARCHAR(150) NULL,
      sucursal       VARCHAR(60)  NULL,
      mensaje        TEXT NULL,
      estado         ENUM('nueva','atendida','descartada') NOT NULL DEFAULT 'nueva',
      notas          TEXT NULL,
      atendida_por   VARCHAR(100) NULL,
      atendida_at    TIMESTAMP NULL,
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_web_consultas_estado (estado, created_at)
    )`));
  // Para poder volver a una publicación anterior: además de lo que lee el sitio,
  // cada publicación guarda las filas tal como estaban en el panel.
  await tryStep('sitio web: publicaciones restaurables', () => addColumnIfMissing('web_publicaciones', 'datos', 'MEDIUMTEXT NULL'));
  await tryStep('sitio web: publicaciones descripción', () => addColumnIfMissing('web_publicaciones', 'nota', 'VARCHAR(200) NULL'));

  // v3: los datos del negocio que muestra el sitio (teléfono, WhatsApp, dirección
  // y horario de cada sede, correo, redes) se guardan aparte, en web_ajustes
  // ('negocio'): son del sitio web. De `sucursales` y `configuracion` del
  // sistema solo se LEEN los nombres de las sedes y el horario de citas.
  // v3: la bandeja de consultas como herramienta de ventas: a quién le toca,
  // cuándo volver a contactar, y el cliente del sistema si se creó desde aquí.
  await tryStep('sitio web: consultas asignadas', async () => {
    await addColumnIfMissing('web_consultas', 'asignada_a', 'INT NULL');
    await addColumnIfMissing('web_consultas', 'asignada_nombre', 'VARCHAR(100) NULL');
    await addColumnIfMissing('web_consultas', 'seguimiento', 'DATE NULL');
    await addColumnIfMissing('web_consultas', 'cliente_id', 'INT NULL');
    await addColumnIfMissing('web_consultas', 'cedula', 'VARCHAR(20) NULL');
    await crearIndiceSiFalta('web_consultas', 'idx_web_consultas_seguimiento', '(seguimiento)');
  });

  // v4: motos elegidas a mano para la tira "Nuevo ingreso" del inicio del sitio
  // (cuando esa tira se arma a mano en vez de por fecha de ingreso).
  await tryStep('sitio web: moto destacada', () => addColumnIfMissing('web_motos', 'destacada', 'TINYINT(1) NOT NULL DEFAULT 0'));

  // Reseñas que la gente deja en el sitio. Tenían su propia base y su propia
  // API; viven aquí, con el resto del sitio, para que haya una sola base y se
  // aprueben desde el panel. Entran como 'pendiente': nada se muestra hasta que
  // alguien del taller lo aprueba.
  await tryStep('sitio web: reseñas', () => pool.query(`
    CREATE TABLE IF NOT EXISTS web_resenas (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      nombre        VARCHAR(100) NOT NULL,
      calificacion  TINYINT UNSIGNED NOT NULL,
      comentario    TEXT NOT NULL,
      estado        ENUM('pendiente','aprobada','oculta') NOT NULL DEFAULT 'pendiente',
      revisada_por  VARCHAR(100) NULL,
      revisada_at   TIMESTAMP NULL,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_web_resenas_estado (estado, created_at)
    )`));
  // Verificación: el teléfono de quien deja la reseña (no se publica) y, si
  // coincide con un cliente del sistema, cuál. Con cliente, la reseña sale en el
  // sitio como «Cliente verificado».
  await tryStep('sitio web: reseñas teléfono', () => addColumnIfMissing('web_resenas', 'telefono', 'VARCHAR(30) NULL'));
  await tryStep('sitio web: reseñas cliente', () => addColumnIfMissing('web_resenas', 'cliente_id', 'INT NULL'));

  // Servicio rápido de Ingresar ahora: cuántos minutos dura (20, 30 o 40). NULL = normal, por horas.
  await tryStep('citas: minutos del servicio rápido', () => addColumnIfMissing('citas', 'duracion_min', 'SMALLINT UNSIGNED NULL'));

  // Eventos de seguridad (utils/eventos-seguridad.js): logins fallidos, cambios de rol,
  // cuentas desactivadas… Los lee el vigilante de n8n por /api/monitor/seguridad.
  await tryStep('eventos_seguridad', () => pool.query(`
    CREATE TABLE IF NOT EXISTS eventos_seguridad (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      tipo       VARCHAR(40) NOT NULL,
      email      VARCHAR(190) NULL,
      ip         VARCHAR(64) NULL,
      usuario_id INT NULL,
      actor_id   INT NULL,
      detalle    VARCHAR(300) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_eventos_seguridad_fecha (created_at),
      INDEX idx_eventos_seguridad_tipo (tipo, created_at)
    ) DEFAULT CHARSET=utf8mb4`));

  // Varios servicios por cita (el cliente marca "Cambio de aceite" y "Frenos"). Cada
  // uno va en su fila, para que los reportes cuenten cada servicio y el aviso de
  // mantenimiento los reconozca. `citas.tipo_servicio` sigue con el primero (lo que ya
  // lo leía no cambia) y `citas.servicios` guarda el texto para mostrar
  // ("Cambio de aceite + Frenos"); los dos los escribe solo utils/servicios-cita.js.
  await tryStep('cita_servicios', () => pool.query(`
    CREATE TABLE IF NOT EXISTS cita_servicios (
      id       INT AUTO_INCREMENT PRIMARY KEY,
      cita_id  INT NOT NULL,
      servicio VARCHAR(100) NOT NULL,
      orden    TINYINT UNSIGNED NOT NULL DEFAULT 0,
      INDEX idx_cita_servicios_cita (cita_id),
      INDEX idx_cita_servicios_servicio (servicio),
      FOREIGN KEY (cita_id) REFERENCES citas(id) ON DELETE CASCADE
    )`));
  await tryStep('citas: texto de los servicios', () => addColumnIfMissing('citas', 'servicios', 'VARCHAR(600) NULL'));
  // Las citas de antes tenían un solo servicio: pasa a la tabla y al texto. Solo toca
  // las que todavía no tienen filas, así que correrlo en cada arranque no repite nada.
  await tryStep('cita_servicios: citas de antes', async () => {
    await pool.query(`
      INSERT INTO cita_servicios (cita_id, servicio, orden)
      SELECT c.id, TRIM(c.tipo_servicio), 0 FROM citas c
      WHERE c.tipo_servicio IS NOT NULL AND TRIM(c.tipo_servicio) <> ''
        AND NOT EXISTS (SELECT 1 FROM cita_servicios cs WHERE cs.cita_id = c.id)`);
    await pool.query(`
      UPDATE citas SET servicios = TRIM(tipo_servicio)
      WHERE servicios IS NULL AND tipo_servicio IS NOT NULL AND TRIM(tipo_servicio) <> ''`);
  });

  // Por qué se canceló una orden (lo pide la pantalla al cancelar; se ve en la orden).
  await tryStep('ordenes: motivo de cancelación', () => addColumnIfMissing('ordenes_trabajo', 'motivo_cancelacion', 'VARCHAR(300) NULL'));
}

// Ejecuta un paso aislado: si falla, lo loguea y sigue (no aborta la migración).
async function tryStep(label, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`⚠️  Migración (${label}) omitida:`, err.code || err.message);
  }
}

// Crea un índice solo si no existe (idempotente). `opts.unico` para índice único.
async function crearIndiceSiFalta(tabla, nombre, columnas, { unico = false } = {}) {
  const [[existe]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [tabla, nombre]
  );
  if (!existe.n) {
    await pool.query(`CREATE ${unico ? 'UNIQUE ' : ''}INDEX ${nombre} ON ${tabla} ${columnas}`);
    console.log(`🔧 Migración: índice ${nombre} en ${tabla} creado`);
  }
}

// Agrega una columna solo si no existe (idempotente, no destructivo).
async function addColumnIfMissing(tabla, columna, definicion) {
  const [[existe]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tabla, columna]
  );
  if (!existe.n) {
    await pool.query(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
    console.log(`🔧 Migración: ${tabla}.${columna} agregada`);
  }
}

async function addFkIfMissing(tabla, fkName, columna, refTabla, refColumna) {
  const [[existe]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
    [tabla, fkName]
  );
  if (!existe.n) {
    await pool.query(`ALTER TABLE ${tabla} ADD CONSTRAINT ${fkName} FOREIGN KEY (${columna}) REFERENCES ${refTabla}(${refColumna})`);
    console.log(`🔧 Migración: FK ${fkName} en ${tabla} creada`);
  }
}

// Las tres capas, en el único orden que funciona:
//   1. ensureSchema (arriba)    — el esquema de UN taller, tal como lo dejó MS Motos.
//   2. aplicarMultiTenant       — lo convierte en multi-taller: tenants, vehiculos, tenant_id.
//   3. ensureSchemaSaaS         — encima, lo propio del SaaS: las tablas de Motiq.
//
// Invertir 2 y 3 no anda: la capa del SaaS da por hecho que tenant_id ya está.
const { aplicarMultiTenant } = require('./multi-tenant');
const { ensureSchemaSaaS } = require('./auto-migrate-saas');

async function ensureSchemaCompleto() {
  await ensureSchema();
  await aplicarMultiTenant();
  await ensureSchemaSaaS();
}

module.exports = { ensureSchema: ensureSchemaCompleto, ensureSchemaSoloTaller: ensureSchema };
