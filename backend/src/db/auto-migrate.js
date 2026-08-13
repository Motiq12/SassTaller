// Migraciones idempotentes que corren al arrancar el servidor.
// Seguras de ejecutar en cada deploy: solo aplican el cambio si falta.
const { pool } = require('./pool');

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

    // Placa única a nivel de base (no solo en la app). Columna generada normalizada
    // (sin espacios/guiones, mayúsculas) + índice único. Se guarda cada paso por
    // separado para que, si hay placas duplicadas heredadas, el índice falle sin
    // abortar el resto de la migración (la validación de la app sigue cubriendo).
    await tryStep('vehiculos.placa_norm', () =>
      addColumnIfMissing(
        'vehiculos', 'placa_norm',
        "VARCHAR(32) AS (UPPER(REPLACE(REPLACE(placa,' ',''),'-',''))) STORED"
      )
    );
    // La placa es única DENTRO de cada taller, no en todo el SaaS: que otro taller
    // atienda esa moto no es asunto de este. El índice global anterior
    // (uq_vehiculos_placa_norm) se elimina si sobrevive de una versión previa —si no,
    // este mismo arranque volvería a imponer unicidad entre talleres y el segundo
    // que registre la placa recibiría un choque que no le corresponde.
    await tryStep('uq_vehiculos_tenant', () =>
      crearIndiceSiFalta('vehiculos', 'uq_vehiculos_tenant', '(tenant_id, placa_norm)', { unico: true })
    );
    await tryStep('quitar uq_vehiculos_placa_norm global', () =>
      borrarIndiceSiExiste('vehiculos', 'uq_vehiculos_placa_norm')
    );

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
    // Siembra la fila única con valores por defecto (idempotente: INSERT IGNORE).
    // Horarios: 0=Dom … 6=Sáb. L-V 08-17, Sáb 08-13, Dom cerrado.
    await tryStep('seed configuracion', () =>
      pool.query(
        // Configuración del primer taller (tenant 1). El nombre va genérico: decía
        // "MS Motos", y como es un INSERT IGNORE solo pega en instalaciones nuevas —
        // o sea que cualquiera que montara Motiq desde cero arrancaba con el nombre
        // del taller original. Lo cambia en su configuración al entrar.
        `INSERT IGNORE INTO configuracion
           (tenant_id, id, nombre_taller, telefono, email, direccion,
            max_citas_hora, dias_anticipacion, duracion_cita_min, horarios)
         VALUES (1, 1, 'Mi taller', '', '', '', 2, 30, 90, ?)`,
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
      // Primera sucursal del tenant 1, con nombre genérico. Antes sembraba "Liberia"
      // y "Cañas", que son las sedes reales del taller de donde salió este sistema:
      // en una instalación nueva aparecían dos locales inventados que el dueño tenía
      // que borrar. Los talleres que se dan de alta crean la suya en el onboarding.
      // El id 1 se mantiene fijo porque el backfill de datos viejos lo asume.
      pool.query("INSERT IGNORE INTO sucursales (tenant_id, id, nombre, orden) VALUES (1, 1, 'Principal', 1)")
    );

    // Catálogo de servicios editable desde el panel. Antes vivía hardcodeado en
    // utils/servicios.js (portal) y, con otros nombres, en el formulario de recepción.
    // `citas.tipo_servicio` sigue guardando el TEXTO, no un id: así renombrar o borrar
    // un servicio no reescribe ni rompe el historial ya agendado.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS servicios (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id  INT NOT NULL,
        nombre     VARCHAR(120) NOT NULL,
        activo     TINYINT(1) NOT NULL DEFAULT 1,
        orden      INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        -- El nombre es único por taller: dos talleres pueden ofrecer "Cambio de aceite".
        UNIQUE KEY uq_servicios_tenant (tenant_id, nombre)
      )
    `);
    // Semilla con los dos catálogos que estaban dispersos, unificados. Sin esto, al
    // desplegar el portal se quedaría sin nada que ofrecer. INSERT IGNORE + UNIQUE
    // lo hace idempotente y respeta cualquier edición posterior del taller.
    // El catálogo es POR TALLER, así que la semilla se cruza contra tenants en vez de
    // insertar filas sueltas: cada taller existente arranca con la lista completa y
    // puede editarla sin afectar a los demás. INSERT IGNORE contra el único
    // (tenant_id, nombre) lo mantiene idempotente y respeta ediciones posteriores.
    await tryStep('seed servicios', () =>
      pool.query(
        `INSERT IGNORE INTO servicios (tenant_id, nombre, orden)
         SELECT t.id, v.nombre, v.orden
         FROM tenants t
         JOIN (
                     SELECT 'Cambio de aceite y filtros' AS nombre, 1 AS orden
           UNION ALL SELECT 'Revisión completa', 2
           UNION ALL SELECT 'Cambio de pastillas de freno', 3
           UNION ALL SELECT 'Kit de transmisión (cadena y piñones)', 4
           UNION ALL SELECT 'Diagnóstico electrónico', 5
           UNION ALL SELECT 'Cambio de neumáticos', 6
           UNION ALL SELECT 'Mantenimiento preventivo', 7
           UNION ALL SELECT 'Sistema eléctrico', 8
           UNION ALL SELECT 'Afinamiento', 9
           UNION ALL SELECT 'Otro', 99
         ) v`
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

    // Mensajería interna v2: foto, vínculo a orden y soporte de broadcast.
    await addColumnIfMissing('mensajes_internos', 'foto', 'MEDIUMTEXT NULL');
    await addColumnIfMissing('mensajes_internos', 'orden_id', 'INT NULL');
    await addColumnIfMissing('mensajes_internos', 'tipo', "VARCHAR(20) NOT NULL DEFAULT 'directo'");
    // Los avisos (broadcast) se filtran por rol y se ordenan por fecha. El índice va
    // aquí y no junto a los demás de mensajería porque necesita que `tipo` ya exista:
    // en una base nueva se creaba antes que la columna y abortaba el resto de la
    // migración (en bases ya migradas el error no aparecía).
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

    // ---- Plataforma (migraciones 004 y 005) ----
    // Van acá y no solo en migrations/*.sql para que una base que ya existía se ponga
    // al día sola al arrancar. Sin esto, quien no reimporte el volcado arranca sin
    // estas tablas y el panel de Motiq revienta al primer request.
    //
    // plataforma_admins NO es una tabla de taller: no lleva tenant_id, y su correo es
    // único global. Es la diferencia de fondo con `usuarios`, donde el mismo correo
    // puede repetirse en talleres distintos.
    await tryStep('tabla plataforma_admins', () => pool.query(
      `CREATE TABLE IF NOT EXISTS plataforma_admins (
         id            INT AUTO_INCREMENT PRIMARY KEY,
         nombre        VARCHAR(120) NOT NULL,
         email         VARCHAR(150) NOT NULL,
         password_hash VARCHAR(255) NOT NULL,
         activo        TINYINT(1) NOT NULL DEFAULT 1,
         ultimo_acceso DATETIME NULL,
         created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         UNIQUE KEY uq_plataforma_email (email)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    ));
    await addColumnIfMissing('tenants', 'motivo_estado', 'VARCHAR(200) NULL');
    await addColumnIfMissing('tenants', 'trial_hasta', 'DATE NULL');
    await crearIndiceSiFalta('tenants', 'idx_tenants_estado', '(estado)');

    // El espacio de trabajo de cada administrador de Motiq (migración 008). Los datos
    // del SaaS son compartidos —los dos administran todo—, pero los pendientes, los
    // talleres que cada uno sigue y lo que hizo cada uno son suyos.
    await tryStep('tabla motiq_tareas', () => pool.query(
      `CREATE TABLE IF NOT EXISTS motiq_tareas (
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
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    ));
    await tryStep('tabla motiq_seguidos', () => pool.query(
      `CREATE TABLE IF NOT EXISTS motiq_seguidos (
         admin_id   INT NOT NULL,
         tenant_id  INT NOT NULL,
         nota       VARCHAR(300) NULL,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         PRIMARY KEY (admin_id, tenant_id),
         FOREIGN KEY (admin_id) REFERENCES plataforma_admins(id) ON DELETE CASCADE
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    ));
    // El tenant_id de la bitácora NO lleva clave foránea: cuando se borra un taller,
    // su línea tiene que sobrevivir. Es justo la que hay que poder leer después.
    await tryStep('tabla motiq_bitacora', () => pool.query(
      `CREATE TABLE IF NOT EXISTS motiq_bitacora (
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
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    ));

    // Los límites y el precio de cada plan (migración 009), editables desde el panel
    // de Motiq. Antes vivían solo como constantes en utils/limites.js; esta tabla les
    // da un valor que se puede cambiar sin tocar código ni redesplegar. utils/limites.js
    // sigue siendo la fuente de verdad de la FORMA de un plan (qué campos tiene) — acá
    // solo se guardan los valores, y si la tabla está vacía o no existe, ese archivo
    // sigue funcionando con sus valores de siempre.
    await tryStep('tabla planes_config', () => pool.query(
      `CREATE TABLE IF NOT EXISTS planes_config (
         plan              VARCHAR(20) PRIMARY KEY,
         precio_mensual    INT NOT NULL DEFAULT 0,
         limite_usuarios   INT NULL,
         limite_sucursales INT NULL,
         marca_propia      TINYINT(1) NOT NULL DEFAULT 0,
         reportes_dias     INT NULL,
         updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    ));
    // Semilla con los mismos valores que utils/limites.js trae de fábrica. INSERT IGNORE
    // para que solo pegue la primera vez: una instalación donde alguien ya editó el
    // precio del plan Pro no puede volver a "gratis" cada vez que el server reinicia.
    await tryStep('semilla planes_config', () => pool.query(
      `INSERT IGNORE INTO planes_config (plan, precio_mensual, limite_usuarios, limite_sucursales, marca_propia, reportes_dias) VALUES
         ('trial',  0, NULL, NULL, 1, NULL),
         ('gratis', 0, 2,    1,    0, 30),
         ('pro',    0, NULL, NULL, 1, NULL)`
    ));

    // Quien pide una demo desde la landing. Tampoco lleva tenant_id: todavía no es
    // un taller del sistema, es alguien de afuera preguntando.
    await tryStep('tabla contactos_demo', () => pool.query(
      `CREATE TABLE IF NOT EXISTS contactos_demo (
         id           INT AUTO_INCREMENT PRIMARY KEY,
         nombre       VARCHAR(120) NOT NULL,
         email        VARCHAR(150) NOT NULL,
         telefono     VARCHAR(40)  NULL,
         empresa      VARCHAR(150) NULL,
         volumen      VARCHAR(40)  NULL,
         mensaje      TEXT NULL,
         estado       ENUM('nuevo','contactado','cerrado','descartado') NOT NULL DEFAULT 'nuevo',
         nota_interna VARCHAR(500) NULL,
         origen       VARCHAR(80) NULL,
         created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         INDEX idx_contactos_estado (estado, created_at)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    ));

    // Datos de ejemplo: un taller que está evaluando el sistema no puede juzgar una
    // lista vacía, pero los datos de mentira tienen que poder irse de un botón. La
    // marca va en la fila y no en una tabla aparte porque el borrado tiene que ser
    // exacto — "todo lo creado ese día" se llevaría por delante lo que cargó de verdad.
    for (const tabla of ['clientes', 'vehiculos', 'ordenes_trabajo', 'citas']) {
      await addColumnIfMissing(tabla, 'es_ejemplo', 'TINYINT(1) NOT NULL DEFAULT 0');
    }

    // Si el taller cerró a mano el checklist de arranque. Es lo ÚNICO que se guarda de
    // él: los cuatro pasos se derivan de los datos (¿tiene logo?, ¿hay más de un
    // usuario?, ¿hay alguna orden?), porque un progreso guardado aparte puede terminar
    // diciendo que algo está hecho cuando ya no lo está.
    await addColumnIfMissing('configuracion', 'arranque_oculto', 'TINYINT(1) NOT NULL DEFAULT 0');

    // Correo del personal verificado.
    //
    // Por defecto 1, no 0: los usuarios que ya existían se crearon cuando esto no se
    // pedía, y marcarlos a todos como sin verificar les pondría un aviso en pantalla
    // por algo que nunca se les pidió. Los nuevos dueños de taller salen con 0 desde
    // el alta (ver utils/onboarding).
    await addColumnIfMissing('usuarios', 'email_verificado', 'TINYINT(1) NOT NULL DEFAULT 1');

    // Códigos de verificación del PERSONAL. Tabla aparte de email_verify_codes a
    // propósito: esa tiene cliente_id NOT NULL con clave foránea a clientes, y meter
    // ahí un usuario obligaría a aflojar esa restricción —la que hoy garantiza que
    // ningún código quede huérfano— para ahorrarse una tabla de seis columnas.
    await tryStep('tabla usuario_verify_codes', () => pool.query(
      `CREATE TABLE IF NOT EXISTS usuario_verify_codes (
         id         INT AUTO_INCREMENT PRIMARY KEY,
         tenant_id  INT NOT NULL,
         usuario_id INT NOT NULL,
         code_hash  VARCHAR(255) NOT NULL,
         expires_at DATETIME NOT NULL,
         used       TINYINT(1) NOT NULL DEFAULT 0,
         attempts   INT NOT NULL DEFAULT 0,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         KEY idx_uvc_usuario (usuario_id),
         KEY idx_uvc_tenant (tenant_id),
         CONSTRAINT fk_uvc_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
         CONSTRAINT fk_uvc_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenants (id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    ));

    // ── Índices: el taller va PRIMERO ────────────────────────────────────────
    //
    // Toda consulta del sistema lleva `tenant_id = ?` (lo obliga el guard de
    // tenant-db). Un índice que arranca por `fecha` o por `nombre` deja a MySQL
    // entrar por ahí y descartar después las filas de los otros talleres: con dos
    // clientes no se nota, con doscientos cada taller paga el costo de leer la
    // agenda de todos.
    //
    // Se crea el nuevo ANTES de borrar el viejo, siempre: si el índice respalda una
    // clave foránea, InnoDB rechaza el DROP mientras no haya otro que la cubra.
    const reindexar = [
      ['citas',             'idx_citas_tenant_fecha',      '(tenant_id, fecha, hora)',                    'idx_citas_fecha_hora'],
      ['clientes',          'idx_clientes_tenant_nombre',  '(tenant_id, activo, nombre, apellido)',       'idx_clientes_activo_nombre'],
      ['mensajes_internos', 'idx_msg_tenant_broadcast',    '(tenant_id, tipo, destino_rol, created_at)',  'idx_msg_broadcast'],
      ['mensajes_internos', 'idx_msg_tenant_sucursal',     '(tenant_id, sucursal_id)',                    'idx_msg_sucursal'],
      ['mensaje_lecturas',  'idx_ml_tenant_usuario',       '(tenant_id, usuario_id)',                     'idx_ml_usuario'],
      ['web_vitals',        'idx_wv_tenant_metrica',       '(tenant_id, metrica, created_at)',            'idx_wv_metrica'],
      ['web_vitals',        'idx_wv_tenant_ruta',          '(tenant_id, ruta)',                           'idx_wv_ruta'],
      // Restos del renombre motos → vehículos: el índice se sigue llamando `moto_id`
      // aunque la columna es `vehiculo_id`. Respaldan una FK, así que el orden
      // crear-y-después-borrar no es una preferencia de estilo: sin él, el DROP falla.
      ['citas',             'idx_citas_vehiculo',          '(vehiculo_id)',                               'moto_id'],
      ['ordenes_trabajo',   'idx_ordenes_vehiculo',        '(vehiculo_id)',                               'moto_id'],
    ];
    for (const [tabla, nuevo, columnas, viejo] of reindexar) {
      await tryStep(`índice ${nuevo}`, async () => {
        await crearIndiceSiFalta(tabla, nuevo, columnas);
        await borrarIndiceSiExiste(tabla, viejo);
      });
    }

    // Claves foráneas duplicadas en `citas`: quedaron dos constraints sobre la misma
    // columna (el de nombre automático de MySQL y otro con nombre propio, agregado por
    // una migración posterior). No rompen nada, pero InnoDB comprueba las dos en cada
    // alta y cada cambio de cita.
    await quitarFkDuplicadas('citas', 'tecnico_id');
    await quitarFkDuplicadas('citas', 'sucursal_id');
  } catch (err) {
    console.error('⚠️  Auto-migración falló:', err.code || err.message);
  }
}

// Ejecuta un paso aislado: si falla, lo loguea y sigue (no aborta la migración).
async function tryStep(label, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`⚠️  Migración (${label}) omitida:`, err.code || err.message);
  }
}

// Borra un índice solo si existe (idempotente). Hace falta para retirar índices que
// una versión anterior creó y que ya no corresponden — por ejemplo los únicos
// globales que multi-tenancy convirtió en compuestos con tenant_id.
async function borrarIndiceSiExiste(tabla, nombre) {
  const [[existe]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [tabla, nombre]
  );
  if (existe.n) {
    await pool.query(`DROP INDEX ${nombre} ON ${tabla}`);
    console.log(`🔧 Migración: índice ${nombre} en ${tabla} eliminado`);
  }
}

// Deja UNA sola clave foránea por columna, borrando las repetidas.
//
// Se busca por columna y no por nombre a propósito: `citas_ibfk_4` es un nombre que
// pone MySQL solo, y en una base creada por otro camino puede corresponder a otra
// columna. Borrar por nombre funcionaría en la base de hoy y sacaría la única FK de
// otra columna en la de mañana.
//
// Se conserva la de nombre explícito (`fk_...`) y se van las automáticas: son las que
// no volvería a crear ninguna migración.
async function quitarFkDuplicadas(tabla, columna) {
  const [filas] = await pool.query(
    `SELECT CONSTRAINT_NAME AS nombre FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
        AND REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY (CONSTRAINT_NAME LIKE 'fk\\_%') DESC`,
    [tabla, columna]
  );
  // La primera de la lista es la que se queda (la de nombre explícito, si hay).
  for (const f of filas.slice(1)) {
    await tryStep(`FK duplicada ${f.nombre}`, async () => {
      await pool.query(`ALTER TABLE ${tabla} DROP FOREIGN KEY ${f.nombre}`);
      console.log(`🔧 Migración: FK duplicada ${f.nombre} en ${tabla}.${columna} eliminada`);
    });
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

module.exports = { ensureSchema };
