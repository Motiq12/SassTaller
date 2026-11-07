-- =============================================
-- TallerMS — Schema completo de base de datos
-- Para Railway: este script no incluye CREATE DATABASE ni USE
-- Para local: conectar a la DB proyecto_taller antes de ejecutar
-- =============================================

DROP TABLE IF EXISTS promos;
DROP TABLE IF EXISTS garantia_fotos;
DROP TABLE IF EXISTS garantias;
DROP TABLE IF EXISTS orden_checklist;
DROP TABLE IF EXISTS orden_tiempos;
DROP TABLE IF EXISTS orden_fotos;
DROP TABLE IF EXISTS orden_avances;
DROP TABLE IF EXISTS orden_repuestos;
DROP TABLE IF EXISTS ordenes_trabajo;
DROP TABLE IF EXISTS citas;
DROP TABLE IF EXISTS motos;
DROP TABLE IF EXISTS clientes;
DROP TABLE IF EXISTS usuarios;
DROP TABLE IF EXISTS sucursales;
DROP TABLE IF EXISTS items;

-- Sucursales (locales) del taller. El sistema soporta varios; se siembran Liberia y Cañas.
-- La cita, la orden y el personal se asocian a una sucursal.
CREATE TABLE IF NOT EXISTS sucursales (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  nombre        VARCHAR(100) NOT NULL,
  direccion     VARCHAR(200),
  telefono      VARCHAR(40),
  activa        TINYINT(1) DEFAULT 1,
  orden         INT DEFAULT 0,                         -- orden de presentación en el selector
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
-- Ids explícitos: las filas viejas se rellenan a Liberia (id=1) de forma determinista.
INSERT IGNORE INTO sucursales (id, nombre, orden) VALUES (1, 'Liberia', 1), (2, 'Cañas', 2);

CREATE TABLE IF NOT EXISTS usuarios (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  nombre        VARCHAR(100) NOT NULL,
  email         VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  rol           ENUM('recepcion','tecnico','admin') NOT NULL DEFAULT 'tecnico',
  telefono      VARCHAR(20),                 -- perfil del mecánico
  especialidades VARCHAR(300),               -- perfil del mecánico (lista separada por comas)
  horario       VARCHAR(200),                -- perfil del mecánico
  sucursal_id   INT,                         -- local del empleado (NULL = atiende ambas)
  activo        TINYINT(1) DEFAULT 1,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id)
);

CREATE TABLE IF NOT EXISTS clientes (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  nombre        VARCHAR(100) NOT NULL,
  apellido      VARCHAR(100) NOT NULL,
  telefono      VARCHAR(20) NOT NULL,
  email         VARCHAR(100),
  cedula        VARCHAR(20),
  direccion     TEXT,
  password_hash VARCHAR(255) NULL,  -- acceso opcional al portal del cliente
  visitas       INT DEFAULT 0,            -- fidelización: entregas acumuladas
  cortesia_disponible TINYINT(1) DEFAULT 0, -- fidelización: cortesía ganada
  notif_avances       TINYINT(1) NOT NULL DEFAULT 1, -- preferencia: avisos de avance
  notif_recordatorios TINYINT(1) NOT NULL DEFAULT 1, -- preferencia: recordatorio de cita
  activo        TINYINT(1) DEFAULT 1,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Códigos de recuperación de contraseña del portal (olvidé mi contraseña).
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
);

CREATE TABLE IF NOT EXISTS motos (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id         INT NOT NULL,
  marca              VARCHAR(50) NOT NULL,
  modelo             VARCHAR(100) NOT NULL,
  anio               YEAR,
  placa              VARCHAR(20),
  color              VARCHAR(50),
  numero_motor       VARCHAR(50),
  numero_chasis      VARCHAR(50),
  kilometraje_actual INT DEFAULT 0,
  foto_url           VARCHAR(500),
  activa             TINYINT(1) DEFAULT 1,
  -- Placa normalizada (sin espacios/guiones, mayúsculas) con índice único:
  -- evita duplicados a nivel de base, no solo en la app.
  placa_norm         VARCHAR(32) AS (UPPER(REPLACE(REPLACE(placa,' ',''),'-',''))) STORED,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_motos_placa_norm (placa_norm),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);

CREATE TABLE IF NOT EXISTS citas (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id    INT NOT NULL,
  moto_id       INT,
  usuario_id    INT,
  tecnico_id    INT,                                  -- mecánico asignado
  sucursal_id   INT,                                  -- local donde se atiende la cita
  fecha         DATE NOT NULL,
  hora          TIME NOT NULL,
  motivo        TEXT NOT NULL,                        -- notas del cliente
  tipo_servicio VARCHAR(100),                         -- tipo de servicio elegido
  estado        ENUM('agendado','en_revision','en_mantenimiento','listo','entregado','cancelado') NOT NULL DEFAULT 'agendado',
  monto         DECIMAL(10,2) DEFAULT 0,              -- plata cobrada (la anota el mecánico)
  calificacion  TINYINT,                              -- la pone el cliente (1-5)
  comentario_satisfaccion TEXT,
  fecha_inicio  TIMESTAMP NULL,                       -- al empezar el trabajo
  fecha_fin     TIMESTAMP NULL,                       -- al entregar
  hora_llegada  DATETIME NULL,                        -- check-in en mostrador (el cliente llegó)
  orden_id      INT,                                  -- orden de trabajo generada/enlazada (puente cita ↔ orden)
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_citas_fecha_hora (fecha, hora),
  INDEX idx_citas_orden (orden_id),
  INDEX idx_citas_sucursal_fecha_hora (sucursal_id, fecha, hora),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  FOREIGN KEY (moto_id)    REFERENCES motos(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (tecnico_id) REFERENCES usuarios(id),
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id)
);

CREATE TABLE IF NOT EXISTS ordenes_trabajo (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  numero_orden          VARCHAR(20) UNIQUE NOT NULL,
  moto_id               INT NOT NULL,
  cliente_id            INT NOT NULL,
  sucursal_id           INT,                          -- local que atiende la orden (heredado de la cita)
  recepcionista_id      INT,
  tecnico_id            INT,
  estado                ENUM('recepcion','diagnostico','esperando_aprobacion','esperando_repuestos','en_reparacion','lista_entrega','entregada','cancelada') NOT NULL DEFAULT 'recepcion',
  problema_reportado    TEXT NOT NULL,
  kilometraje_ingreso   INT,
  nivel_combustible     ENUM('vacio','cuarto','mitad','tres_cuartos','lleno') DEFAULT 'cuarto',
  accesorios_entregados TEXT,
  estado_fisico         TEXT,
  prioridad             ENUM('normal','urgente','emergencia','garantia') DEFAULT 'normal',
  categoria             ENUM('rapido','garantia','emergencia','diagnostico','preventivo','mayor') DEFAULT 'diagnostico',
  diagnostico           TEXT,
  tiempo_estimado_horas DECIMAL(5,2),
  costo_mano_obra       DECIMAL(10,2) DEFAULT 0,
  costo_repuestos       DECIMAL(10,2) DEFAULT 0,
  descuento             DECIMAL(10,2) DEFAULT 0,
  aprobado_por_cliente  TINYINT(1) DEFAULT 0,
  aprobacion_cliente    ENUM('pendiente','aprobado','rechazado') NOT NULL DEFAULT 'pendiente',
  motivo_rechazo        TEXT,
  fecha_aprobacion      TIMESTAMP NULL,
  total_aprobado        DECIMAL(10,2) NULL,
  fecha_ingreso         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  fecha_estimada_entrega DATE,
  fecha_entrega_real    TIMESTAMP NULL,
  metodo_pago           ENUM('efectivo','sinpe','tarjeta','transferencia') NULL,
  garantia_dias         INT DEFAULT 0,
  observaciones_finales TEXT,
  calificacion          TINYINT NULL,
  comentario_satisfaccion TEXT,
  visita_contada        TINYINT(1) DEFAULT 0,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (moto_id)          REFERENCES motos(id),
  FOREIGN KEY (cliente_id)       REFERENCES clientes(id),
  FOREIGN KEY (sucursal_id)      REFERENCES sucursales(id),
  FOREIGN KEY (recepcionista_id) REFERENCES usuarios(id),
  FOREIGN KEY (tecnico_id)       REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS orden_repuestos (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  orden_id       INT NOT NULL,
  nombre         VARCHAR(200) NOT NULL,
  cantidad       INT NOT NULL DEFAULT 1,
  costo_unitario DECIMAL(10,2) DEFAULT 0,
  estado         ENUM('disponible','pendiente','pedido_especial','solicitado') DEFAULT 'pendiente',
  adicional      TINYINT(1) NOT NULL DEFAULT 0,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (orden_id) REFERENCES ordenes_trabajo(id)
);

CREATE TABLE IF NOT EXISTS orden_avances (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  orden_id    INT NOT NULL,
  usuario_id  INT NOT NULL,
  descripcion TEXT NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (orden_id)   REFERENCES ordenes_trabajo(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS orden_fotos (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  orden_id    INT NOT NULL,
  url         MEDIUMTEXT NOT NULL,
  tipo        ENUM('ingreso','diagnostico','avance','entrega') DEFAULT 'ingreso',
  descripcion VARCHAR(200),
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (orden_id) REFERENCES ordenes_trabajo(id)
);

CREATE TABLE IF NOT EXISTS orden_tiempos (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  orden_id INT NOT NULL,
  etapa    ENUM('recepcion','diagnostico','esperando_aprobacion','esperando_repuestos','en_reparacion','lista_entrega') NOT NULL,
  inicio   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  fin      TIMESTAMP NULL,
  FOREIGN KEY (orden_id) REFERENCES ordenes_trabajo(id)
);

CREATE TABLE IF NOT EXISTS orden_checklist (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  orden_id           INT UNIQUE NOT NULL,
  prueba_realizada   TINYINT(1) DEFAULT 0,
  lavado             TINYINT(1) DEFAULT 0,
  calidad_revisada   TINYINT(1) DEFAULT 0,
  facturacion_lista  TINYINT(1) DEFAULT 0,
  cliente_notificado TINYINT(1) DEFAULT 0,
  observaciones      TEXT,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (orden_id) REFERENCES ordenes_trabajo(id)
);

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
);

CREATE TABLE IF NOT EXISTS garantia_fotos (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  garantia_id INT NOT NULL,
  url         MEDIUMTEXT NOT NULL,
  descripcion VARCHAR(200),
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (garantia_id) REFERENCES garantias(id)
);

CREATE TABLE IF NOT EXISTS promos (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  titulo      VARCHAR(150) NOT NULL,
  descripcion TEXT NOT NULL,
  descuento   INT DEFAULT 0,
  imagen      MEDIUMTEXT,                 -- data URL base64 de la oferta
  precio_final INT,                       -- precio final opcional (lo fija el admin)
  activa      TINYINT(1) DEFAULT 1,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Tareas pendientes del mecánico (checklist propio).
CREATE TABLE IF NOT EXISTS tareas_mecanico (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  tecnico_id   INT NOT NULL,
  titulo       VARCHAR(150) NOT NULL,
  detalle      VARCHAR(300),
  prioridad    ENUM('baja','normal','alta','urgente') NOT NULL DEFAULT 'normal',
  hecha        TINYINT(1) DEFAULT 0,
  asignado_por INT,                                    -- admin que asignó (NULL = la creó el propio técnico)
  vence        DATETIME NULL,                          -- fecha límite opcional
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tarea_tecnico (tecnico_id),
  FOREIGN KEY (tecnico_id)   REFERENCES usuarios(id),
  FOREIGN KEY (asignado_por) REFERENCES usuarios(id)
);

-- Mensajería interna mecánico ↔ recepción.
CREATE TABLE IF NOT EXISTS mensajes_internos (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  remitente_id INT NOT NULL,
  destino_rol  VARCHAR(20),
  destino_id   INT,
  mensaje      VARCHAR(500) NOT NULL,
  leido        TINYINT(1) DEFAULT 0,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_msg_remitente (remitente_id),
  INDEX idx_msg_destino (destino_id),
  FOREIGN KEY (remitente_id) REFERENCES usuarios(id),
  FOREIGN KEY (destino_id)   REFERENCES usuarios(id)
);

-- Feed de notificaciones de avance para el cliente (portal).
CREATE TABLE IF NOT EXISTS notificaciones (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT NOT NULL,
  cita_id    INT,
  titulo     VARCHAR(150) NOT NULL,
  mensaje    VARCHAR(255) NOT NULL,
  tipo       VARCHAR(30) NOT NULL DEFAULT 'estado',  -- evento que la generó (icono/color en el portal)
  leida      TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cliente (cliente_id),
  INDEX idx_cliente_leida (cliente_id, leida),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  FOREIGN KEY (cita_id)    REFERENCES citas(id)
);

-- Configuración del taller (fila única id=1): datos del negocio, horarios de
-- atención, capacidad de la agenda y preferencias de notificación. El portal
-- lee de aquí los cupos/horas de la agenda.
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
  horarios            JSON,                          -- [{dia:0..6, abre, cierra, activo}]
  notif_estado        TINYINT(1) DEFAULT 1,
  notif_recordatorio  TINYINT(1) DEFAULT 1,
  notif_cotizacion    TINYINT(1) DEFAULT 1,
  notif_email_entrega TINYINT(1) DEFAULT 0,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
