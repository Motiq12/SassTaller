-- MySQL dump 10.13  Distrib 8.4.3, for Win64 (x86_64)
--
-- Host: 127.0.0.1    Database: sasstaller
-- ------------------------------------------------------
-- Server version	8.4.3

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `citas`
--

DROP TABLE IF EXISTS `citas`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `citas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `cliente_id` int NOT NULL,
  `vehiculo_id` int DEFAULT NULL,
  `usuario_id` int DEFAULT NULL,
  `tecnico_id` int DEFAULT NULL,
  `sucursal_id` int DEFAULT NULL,
  `fecha` date NOT NULL,
  `hora` time NOT NULL,
  `motivo` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `tipo_servicio` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `estado` enum('agendado','en_revision','en_mantenimiento','listo','entregado','cancelado') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'agendado',
  `monto` decimal(10,2) DEFAULT '0.00',
  `calificacion` tinyint DEFAULT NULL,
  `comentario_satisfaccion` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `fecha_inicio` timestamp NULL DEFAULT NULL,
  `fecha_fin` timestamp NULL DEFAULT NULL,
  `hora_llegada` datetime DEFAULT NULL,
  `orden_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `confirmada_cliente` tinyint(1) DEFAULT '0',
  `fecha_listo` timestamp NULL DEFAULT NULL,
  `recordatorio_enviado` tinyint(1) NOT NULL DEFAULT '0',
  `no_show` tinyint(1) NOT NULL DEFAULT '0',
  `fecha_cancelacion` datetime DEFAULT NULL,
  `tenant_id` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_citas_fecha_hora` (`fecha`,`hora`),
  KEY `idx_citas_orden` (`orden_id`),
  KEY `idx_citas_sucursal_fecha_hora` (`sucursal_id`,`fecha`,`hora`),
  KEY `cliente_id` (`cliente_id`),
  KEY `moto_id` (`vehiculo_id`),
  KEY `usuario_id` (`usuario_id`),
  KEY `fk_citas_tecnico` (`tecnico_id`),
  KEY `idx_citas_tenant` (`tenant_id`),
  CONSTRAINT `citas_ibfk_1` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`),
  CONSTRAINT `citas_ibfk_2` FOREIGN KEY (`vehiculo_id`) REFERENCES `vehiculos` (`id`),
  CONSTRAINT `citas_ibfk_3` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `citas_ibfk_4` FOREIGN KEY (`tecnico_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `citas_ibfk_5` FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales` (`id`),
  CONSTRAINT `fk_citas_orden` FOREIGN KEY (`orden_id`) REFERENCES `ordenes_trabajo` (`id`),
  CONSTRAINT `fk_citas_sucursal` FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales` (`id`),
  CONSTRAINT `fk_citas_tecnico` FOREIGN KEY (`tecnico_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `fk_citas_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `citas`
--

LOCK TABLES `citas` WRITE;
/*!40000 ALTER TABLE `citas` DISABLE KEYS */;
INSERT INTO `citas` (`id`, `cliente_id`, `vehiculo_id`, `usuario_id`, `tecnico_id`, `sucursal_id`, `fecha`, `hora`, `motivo`, `tipo_servicio`, `estado`, `monto`, `calificacion`, `comentario_satisfaccion`, `fecha_inicio`, `fecha_fin`, `hora_llegada`, `orden_id`, `created_at`, `updated_at`, `confirmada_cliente`, `fecha_listo`, `recordatorio_enviado`, `no_show`, `fecha_cancelacion`, `tenant_id`) VALUES (1,1,NULL,NULL,NULL,1,'2026-08-20','09:00:00','CITA-DEL-TALLER-1',NULL,'agendado',0.00,NULL,NULL,NULL,NULL,NULL,NULL,'2026-08-12 01:46:08','2026-08-12 01:47:06',0,NULL,0,0,NULL,1),(2,2,NULL,NULL,NULL,1,'2026-08-20','10:00:00','CITA-DEL-TALLER-2',NULL,'agendado',0.00,NULL,NULL,NULL,NULL,NULL,NULL,'2026-08-12 01:46:08','2026-08-12 01:47:06',0,NULL,0,0,NULL,2);
/*!40000 ALTER TABLE `citas` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `clientes`
--

DROP TABLE IF EXISTS `clientes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `clientes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `apellido` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `telefono` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cedula` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `direccion` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `password_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `visitas` int DEFAULT '0',
  `cortesia_disponible` tinyint(1) DEFAULT '0',
  `notif_avances` tinyint(1) NOT NULL DEFAULT '1',
  `notif_recordatorios` tinyint(1) NOT NULL DEFAULT '1',
  `activo` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `foto` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `email_verificado` tinyint(1) NOT NULL DEFAULT '1',
  `email_pendiente` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tenant_id` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_clientes_activo_nombre` (`activo`,`nombre`,`apellido`),
  KEY `idx_clientes_tenant` (`tenant_id`),
  CONSTRAINT `fk_clientes_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=35 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `clientes`
--

LOCK TABLES `clientes` WRITE;
/*!40000 ALTER TABLE `clientes` DISABLE KEYS */;
INSERT INTO `clientes` (`id`, `nombre`, `apellido`, `telefono`, `email`, `cedula`, `direccion`, `password_hash`, `visitas`, `cortesia_disponible`, `notif_avances`, `notif_recordatorios`, `activo`, `created_at`, `updated_at`, `foto`, `email_verificado`, `email_pendiente`, `tenant_id`) VALUES (1,'Cliente','DelUno','111-1111',NULL,NULL,NULL,NULL,0,0,1,1,1,'2026-08-12 01:46:08','2026-08-12 01:46:08',NULL,1,NULL,1),(2,'Cliente','DelDos','222-2222',NULL,NULL,NULL,NULL,0,0,1,1,1,'2026-08-12 01:46:08','2026-08-12 01:46:08',NULL,1,NULL,2),(32,'Cliente','Autos','8888-7777',NULL,'1-2222-3333',NULL,NULL,0,0,1,1,1,'2026-08-12 17:54:49','2026-08-12 17:54:49',NULL,1,NULL,36),(33,'Ana','Uno','8888-1111','cliente-1786557361919@t.com','1-2222-3333',NULL,'$2b$10$KPp0s9ggMXn4MOjS.WoeQu4u8QEiP5yWCmZxhF1PGLrsVlBDhnlQG',0,0,1,1,1,'2026-08-12 17:56:02','2026-08-12 17:56:02',NULL,1,NULL,1),(34,'Ana','Dos','8888-2222','cliente-1786557361919@t.com','1-2222-3333',NULL,'$2b$10$Yg7X/bHUL7tSUtt7YqIE8OU7xMSml.3ZAbeE773KpZW.bOpfld8vG',0,0,1,1,1,'2026-08-12 17:56:02','2026-08-12 17:56:02',NULL,1,NULL,2);
/*!40000 ALTER TABLE `clientes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `configuracion`
--

DROP TABLE IF EXISTS `configuracion`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `configuracion` (
  `id` tinyint NOT NULL,
  `nombre_taller` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `telefono` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `direccion` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `logo` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `max_citas_hora` int DEFAULT '2',
  `dias_anticipacion` int DEFAULT '30',
  `duracion_cita_min` int DEFAULT '90',
  `horarios` json DEFAULT NULL,
  `notif_estado` tinyint(1) DEFAULT '1',
  `notif_recordatorio` tinyint(1) DEFAULT '1',
  `notif_cotizacion` tinyint(1) DEFAULT '1',
  `notif_email_entrega` tinyint(1) DEFAULT '0',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `cancelacion_horas_min` int DEFAULT '2',
  `visitas_para_cortesia` int DEFAULT '7',
  `zona_horaria_offset` int DEFAULT '-6',
  `garantia_dias` int DEFAULT '30',
  `metodos_pago` json DEFAULT NULL,
  `tenant_id` int NOT NULL,
  `tipos_vehiculo` json DEFAULT NULL COMMENT 'Tipos que atiende el taller, ej. ["moto","auto"]',
  `color_primario` varchar(7) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Color de marca del taller en hex (#rrggbb). NULL = por defecto',
  PRIMARY KEY (`tenant_id`,`id`),
  KEY `idx_configuracion_tenant` (`tenant_id`),
  CONSTRAINT `fk_configuracion_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `configuracion`
--

LOCK TABLES `configuracion` WRITE;
/*!40000 ALTER TABLE `configuracion` DISABLE KEYS */;
INSERT INTO `configuracion` (`id`, `nombre_taller`, `telefono`, `email`, `direccion`, `logo`, `max_citas_hora`, `dias_anticipacion`, `duracion_cita_min`, `horarios`, `notif_estado`, `notif_recordatorio`, `notif_cotizacion`, `notif_email_entrega`, `updated_at`, `cancelacion_horas_min`, `visitas_para_cortesia`, `zona_horaria_offset`, `garantia_dias`, `metodos_pago`, `tenant_id`, `tipos_vehiculo`, `color_primario`) VALUES (1,'MS Motos','','','',NULL,2,30,90,'[{\"dia\": 0, \"abre\": \"08:00\", \"activo\": 0, \"cierra\": \"13:00\"}, {\"dia\": 1, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 2, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 3, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 4, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 5, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 6, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"13:00\"}]',1,1,1,0,'2026-08-12 06:09:57',2,7,-6,30,NULL,1,'[\"moto\"]','#e11d48'),(1,'Autos Premium',NULL,'marca-289201@t.com',NULL,NULL,2,30,90,'[{\"dia\": 0, \"abre\": \"08:00\", \"activo\": 0, \"cierra\": \"13:00\"}, {\"dia\": 1, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 2, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 3, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 4, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 5, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 6, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"13:00\"}]',1,1,1,0,'2026-08-12 17:54:49',2,7,-6,30,'[{\"valor\": \"efectivo\", \"etiqueta\": \"Efectivo\"}, {\"valor\": \"sinpe\", \"etiqueta\": \"SINPE Móvil\"}, {\"valor\": \"tarjeta\", \"etiqueta\": \"Tarjeta\"}, {\"valor\": \"transferencia\", \"etiqueta\": \"Transferencia\"}]',35,'[\"auto\"]','#0f766e'),(1,'Taller Solo Autos','','duenio-autos-289722@t.com','',NULL,2,30,90,'[{\"dia\": 0, \"abre\": \"08:00\", \"activo\": 0, \"cierra\": \"13:00\"}, {\"dia\": 1, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 2, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 3, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 4, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 5, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 6, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"13:00\"}]',1,1,1,0,'2026-08-12 17:54:49',2,7,-6,30,'[{\"valor\": \"efectivo\", \"etiqueta\": \"Efectivo\"}, {\"valor\": \"sinpe\", \"etiqueta\": \"SINPE Móvil\"}, {\"valor\": \"tarjeta\", \"etiqueta\": \"Tarjeta\"}, {\"valor\": \"transferencia\", \"etiqueta\": \"Transferencia\"}]',36,'[\"auto\"]',NULL),(1,'Taller Prueba','2222-0000','duenio-290086@t.com','Calle Falsa 123',NULL,2,30,90,'[{\"dia\": 0, \"abre\": \"08:00\", \"activo\": 0, \"cierra\": \"13:00\"}, {\"dia\": 1, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 2, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 3, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 4, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 5, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 6, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"13:00\"}]',1,1,1,0,'2026-08-12 17:54:50',2,7,-6,30,'[{\"valor\": \"efectivo\", \"etiqueta\": \"Efectivo\"}, {\"valor\": \"sinpe\", \"etiqueta\": \"SINPE Móvil\"}, {\"valor\": \"tarjeta\", \"etiqueta\": \"Tarjeta\"}, {\"valor\": \"transferencia\", \"etiqueta\": \"Transferencia\"}]',37,'[\"moto\"]',NULL),(1,'Taller Prueba','2222-0000','duenio-314640@t.com','Calle Falsa 123',NULL,2,30,90,'[{\"dia\": 0, \"abre\": \"08:00\", \"activo\": 0, \"cierra\": \"13:00\"}, {\"dia\": 1, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 2, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 3, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 4, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 5, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 6, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"13:00\"}]',1,1,1,0,'2026-08-12 17:55:14',2,7,-6,30,'[{\"valor\": \"efectivo\", \"etiqueta\": \"Efectivo\"}, {\"valor\": \"sinpe\", \"etiqueta\": \"SINPE Móvil\"}, {\"valor\": \"tarjeta\", \"etiqueta\": \"Tarjeta\"}, {\"valor\": \"transferencia\", \"etiqueta\": \"Transferencia\"}]',38,'[\"moto\"]',NULL),(1,'Autos Web 451627','','autos-web-451627@t.com','',NULL,2,30,90,'[{\"dia\": 0, \"abre\": \"08:00\", \"activo\": 0, \"cierra\": \"13:00\"}, {\"dia\": 1, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 2, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 3, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 4, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 5, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 6, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"13:00\"}]',1,1,1,0,'2026-08-12 17:57:43',2,7,-6,30,'[{\"valor\": \"efectivo\", \"etiqueta\": \"Efectivo\"}, {\"valor\": \"sinpe\", \"etiqueta\": \"SINPE Móvil\"}, {\"valor\": \"tarjeta\", \"etiqueta\": \"Tarjeta\"}, {\"valor\": \"transferencia\", \"etiqueta\": \"Transferencia\"}]',39,'[\"auto\"]',NULL);
/*!40000 ALTER TABLE `configuracion` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `email_verify_codes`
--

DROP TABLE IF EXISTS `email_verify_codes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `email_verify_codes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `cliente_id` int NOT NULL,
  `code_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `expires_at` datetime NOT NULL,
  `used` tinyint(1) DEFAULT '0',
  `attempts` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `proposito` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'registro',
  `tenant_id` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_verify_cliente` (`cliente_id`),
  KEY `idx_email_verify_codes_tenant` (`tenant_id`),
  CONSTRAINT `email_verify_codes_ibfk_1` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`),
  CONSTRAINT `fk_email_verify_codes_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=23 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `email_verify_codes`
--

LOCK TABLES `email_verify_codes` WRITE;
/*!40000 ALTER TABLE `email_verify_codes` DISABLE KEYS */;
INSERT INTO `email_verify_codes` (`id`, `cliente_id`, `code_hash`, `expires_at`, `used`, `attempts`, `created_at`, `proposito`, `tenant_id`) VALUES (21,33,'$2b$10$FQGblzONyjkfhTb9WvpksuKUUuVUg95cnsAdvShCJbZ7crnXDmv3e','2026-08-12 12:06:02',0,0,'2026-08-12 17:56:02','registro',1),(22,34,'$2b$10$NSlpSv84jSxu.ts9vJJR.u3kwQUdBlITJN/6ON2TkRkRrIB7QJFD2','2026-08-12 12:06:02',0,0,'2026-08-12 17:56:02','registro',2);
/*!40000 ALTER TABLE `email_verify_codes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `garantia_fotos`
--

DROP TABLE IF EXISTS `garantia_fotos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `garantia_fotos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `garantia_id` int NOT NULL,
  `url` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `descripcion` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `tenant_id` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `garantia_id` (`garantia_id`),
  KEY `idx_garantia_fotos_tenant` (`tenant_id`),
  CONSTRAINT `fk_garantia_fotos_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `garantia_fotos_ibfk_1` FOREIGN KEY (`garantia_id`) REFERENCES `garantias` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `garantia_fotos`
--

LOCK TABLES `garantia_fotos` WRITE;
/*!40000 ALTER TABLE `garantia_fotos` DISABLE KEYS */;
/*!40000 ALTER TABLE `garantia_fotos` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `garantias`
--

DROP TABLE IF EXISTS `garantias`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `garantias` (
  `id` int NOT NULL AUTO_INCREMENT,
  `orden_id` int NOT NULL,
  `descripcion_problema` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `cubre_repuestos` tinyint(1) DEFAULT '0',
  `cubre_mano_obra` tinyint(1) DEFAULT '0',
  `estado` enum('abierto','en_revision','aprobado','rechazado','resuelto') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'abierto',
  `resolucion` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `creado_por` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `tenant_id` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `orden_id` (`orden_id`),
  KEY `creado_por` (`creado_por`),
  KEY `idx_garantias_tenant` (`tenant_id`),
  CONSTRAINT `fk_garantias_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `garantias_ibfk_1` FOREIGN KEY (`orden_id`) REFERENCES `ordenes_trabajo` (`id`),
  CONSTRAINT `garantias_ibfk_2` FOREIGN KEY (`creado_por`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `garantias`
--

LOCK TABLES `garantias` WRITE;
/*!40000 ALTER TABLE `garantias` DISABLE KEYS */;
/*!40000 ALTER TABLE `garantias` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `login_codes`
--

DROP TABLE IF EXISTS `login_codes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `login_codes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `cliente_id` int NOT NULL,
  `code_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `expires_at` datetime NOT NULL,
  `used` tinyint(1) DEFAULT '0',
  `attempts` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `tenant_id` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_login_cliente` (`cliente_id`),
  KEY `idx_login_codes_tenant` (`tenant_id`),
  CONSTRAINT `fk_login_codes_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `login_codes_ibfk_1` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `login_codes`
--

LOCK TABLES `login_codes` WRITE;
/*!40000 ALTER TABLE `login_codes` DISABLE KEYS */;
/*!40000 ALTER TABLE `login_codes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `mensaje_lecturas`
--

DROP TABLE IF EXISTS `mensaje_lecturas`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mensaje_lecturas` (
  `mensaje_id` int NOT NULL,
  `usuario_id` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `tenant_id` int NOT NULL,
  PRIMARY KEY (`mensaje_id`,`usuario_id`),
  KEY `idx_ml_usuario` (`usuario_id`),
  KEY `idx_mensaje_lecturas_tenant` (`tenant_id`),
  CONSTRAINT `fk_mensaje_lecturas_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `mensaje_lecturas`
--

LOCK TABLES `mensaje_lecturas` WRITE;
/*!40000 ALTER TABLE `mensaje_lecturas` DISABLE KEYS */;
/*!40000 ALTER TABLE `mensaje_lecturas` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `mensajes_internos`
--

DROP TABLE IF EXISTS `mensajes_internos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mensajes_internos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `remitente_id` int NOT NULL,
  `destino_rol` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `destino_id` int DEFAULT NULL,
  `mensaje` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `leido` tinyint(1) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `foto` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `orden_id` int DEFAULT NULL,
  `tipo` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'directo',
  `sucursal_id` int DEFAULT NULL,
  `tenant_id` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_msg_remitente` (`remitente_id`),
  KEY `idx_msg_destino` (`destino_id`),
  KEY `idx_msg_par` (`remitente_id`,`destino_id`,`created_at`),
  KEY `idx_msg_par_inv` (`destino_id`,`remitente_id`,`created_at`),
  KEY `idx_msg_broadcast` (`tipo`,`destino_rol`,`created_at`),
  KEY `idx_msg_sucursal` (`sucursal_id`),
  KEY `idx_msg_destino_created` (`destino_id`,`created_at`),
  KEY `idx_mensajes_internos_tenant` (`tenant_id`),
  CONSTRAINT `fk_mensajes_internos_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `mensajes_internos_ibfk_1` FOREIGN KEY (`remitente_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `mensajes_internos_ibfk_2` FOREIGN KEY (`destino_id`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `mensajes_internos`
--

LOCK TABLES `mensajes_internos` WRITE;
/*!40000 ALTER TABLE `mensajes_internos` DISABLE KEYS */;
/*!40000 ALTER TABLE `mensajes_internos` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `notificaciones`
--

DROP TABLE IF EXISTS `notificaciones`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notificaciones` (
  `id` int NOT NULL AUTO_INCREMENT,
  `cliente_id` int NOT NULL,
  `cita_id` int DEFAULT NULL,
  `titulo` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `mensaje` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `tipo` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'estado',
  `leida` tinyint(1) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `tenant_id` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cliente` (`cliente_id`),
  KEY `idx_cliente_leida` (`cliente_id`,`leida`),
  KEY `cita_id` (`cita_id`),
  KEY `idx_notificaciones_tenant` (`tenant_id`),
  CONSTRAINT `fk_notificaciones_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `notificaciones_ibfk_1` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`),
  CONSTRAINT `notificaciones_ibfk_2` FOREIGN KEY (`cita_id`) REFERENCES `citas` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notificaciones`
--

LOCK TABLES `notificaciones` WRITE;
/*!40000 ALTER TABLE `notificaciones` DISABLE KEYS */;
/*!40000 ALTER TABLE `notificaciones` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `orden_avances`
--

DROP TABLE IF EXISTS `orden_avances`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `orden_avances` (
  `id` int NOT NULL AUTO_INCREMENT,
  `orden_id` int NOT NULL,
  `usuario_id` int NOT NULL,
  `descripcion` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `tenant_id` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `orden_id` (`orden_id`),
  KEY `usuario_id` (`usuario_id`),
  KEY `idx_orden_avances_tenant` (`tenant_id`),
  CONSTRAINT `fk_orden_avances_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `orden_avances_ibfk_1` FOREIGN KEY (`orden_id`) REFERENCES `ordenes_trabajo` (`id`),
  CONSTRAINT `orden_avances_ibfk_2` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `orden_avances`
--

LOCK TABLES `orden_avances` WRITE;
/*!40000 ALTER TABLE `orden_avances` DISABLE KEYS */;
/*!40000 ALTER TABLE `orden_avances` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `orden_checklist`
--

DROP TABLE IF EXISTS `orden_checklist`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `orden_checklist` (
  `id` int NOT NULL AUTO_INCREMENT,
  `orden_id` int NOT NULL,
  `prueba_realizada` tinyint(1) DEFAULT '0',
  `lavado` tinyint(1) DEFAULT '0',
  `calidad_revisada` tinyint(1) DEFAULT '0',
  `facturacion_lista` tinyint(1) DEFAULT '0',
  `cliente_notificado` tinyint(1) DEFAULT '0',
  `observaciones` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `tenant_id` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `orden_id` (`orden_id`),
  KEY `idx_orden_checklist_tenant` (`tenant_id`),
  CONSTRAINT `fk_orden_checklist_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `orden_checklist_ibfk_1` FOREIGN KEY (`orden_id`) REFERENCES `ordenes_trabajo` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `orden_checklist`
--

LOCK TABLES `orden_checklist` WRITE;
/*!40000 ALTER TABLE `orden_checklist` DISABLE KEYS */;
/*!40000 ALTER TABLE `orden_checklist` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `orden_contadores`
--

DROP TABLE IF EXISTS `orden_contadores`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `orden_contadores` (
  `anio` int NOT NULL,
  `ultimo` int NOT NULL DEFAULT '0',
  `tenant_id` int NOT NULL,
  PRIMARY KEY (`tenant_id`,`anio`),
  KEY `idx_orden_contadores_tenant` (`tenant_id`),
  CONSTRAINT `fk_orden_contadores_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `orden_contadores`
--

LOCK TABLES `orden_contadores` WRITE;
/*!40000 ALTER TABLE `orden_contadores` DISABLE KEYS */;
/*!40000 ALTER TABLE `orden_contadores` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `orden_fotos`
--

DROP TABLE IF EXISTS `orden_fotos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `orden_fotos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `orden_id` int NOT NULL,
  `url` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `tipo` enum('ingreso','diagnostico','avance','entrega') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'ingreso',
  `descripcion` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `tenant_id` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `orden_id` (`orden_id`),
  KEY `idx_orden_fotos_tenant` (`tenant_id`),
  CONSTRAINT `fk_orden_fotos_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `orden_fotos_ibfk_1` FOREIGN KEY (`orden_id`) REFERENCES `ordenes_trabajo` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `orden_fotos`
--

LOCK TABLES `orden_fotos` WRITE;
/*!40000 ALTER TABLE `orden_fotos` DISABLE KEYS */;
/*!40000 ALTER TABLE `orden_fotos` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `orden_repuestos`
--

DROP TABLE IF EXISTS `orden_repuestos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `orden_repuestos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `orden_id` int NOT NULL,
  `nombre` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `cantidad` int NOT NULL DEFAULT '1',
  `costo_unitario` decimal(10,2) DEFAULT '0.00',
  `estado` enum('disponible','pendiente','pedido_especial','solicitado') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'pendiente',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `tenant_id` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `orden_id` (`orden_id`),
  KEY `idx_orden_repuestos_tenant` (`tenant_id`),
  CONSTRAINT `fk_orden_repuestos_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `orden_repuestos_ibfk_1` FOREIGN KEY (`orden_id`) REFERENCES `ordenes_trabajo` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `orden_repuestos`
--

LOCK TABLES `orden_repuestos` WRITE;
/*!40000 ALTER TABLE `orden_repuestos` DISABLE KEYS */;
/*!40000 ALTER TABLE `orden_repuestos` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `orden_tiempos`
--

DROP TABLE IF EXISTS `orden_tiempos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `orden_tiempos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `orden_id` int NOT NULL,
  `etapa` enum('recepcion','diagnostico','esperando_aprobacion','esperando_repuestos','en_reparacion','lista_entrega') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `inicio` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `fin` timestamp NULL DEFAULT NULL,
  `tenant_id` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `orden_id` (`orden_id`),
  KEY `idx_orden_tiempos_tenant` (`tenant_id`),
  CONSTRAINT `fk_orden_tiempos_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `orden_tiempos_ibfk_1` FOREIGN KEY (`orden_id`) REFERENCES `ordenes_trabajo` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `orden_tiempos`
--

LOCK TABLES `orden_tiempos` WRITE;
/*!40000 ALTER TABLE `orden_tiempos` DISABLE KEYS */;
/*!40000 ALTER TABLE `orden_tiempos` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ordenes_trabajo`
--

DROP TABLE IF EXISTS `ordenes_trabajo`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ordenes_trabajo` (
  `id` int NOT NULL AUTO_INCREMENT,
  `numero_orden` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `vehiculo_id` int NOT NULL,
  `cliente_id` int NOT NULL,
  `sucursal_id` int DEFAULT NULL,
  `recepcionista_id` int DEFAULT NULL,
  `tecnico_id` int DEFAULT NULL,
  `estado` enum('recepcion','diagnostico','esperando_aprobacion','esperando_repuestos','en_reparacion','lista_entrega','entregada','cancelada') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'recepcion',
  `problema_reportado` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `kilometraje_ingreso` int DEFAULT NULL,
  `nivel_combustible` enum('vacio','cuarto','mitad','tres_cuartos','lleno') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'cuarto',
  `accesorios_entregados` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `estado_fisico` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `prioridad` enum('normal','urgente','emergencia','garantia') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'normal',
  `categoria` enum('rapido','garantia','emergencia','diagnostico','preventivo','mayor') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'diagnostico',
  `diagnostico` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `tiempo_estimado_horas` decimal(5,2) DEFAULT NULL,
  `costo_mano_obra` decimal(10,2) DEFAULT '0.00',
  `costo_repuestos` decimal(10,2) DEFAULT '0.00',
  `descuento` decimal(10,2) DEFAULT '0.00',
  `aprobado_por_cliente` tinyint(1) DEFAULT '0',
  `aprobacion_cliente` enum('pendiente','aprobado','rechazado') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pendiente',
  `motivo_rechazo` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `fecha_aprobacion` timestamp NULL DEFAULT NULL,
  `fecha_ingreso` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `fecha_estimada_entrega` date DEFAULT NULL,
  `fecha_entrega_real` timestamp NULL DEFAULT NULL,
  `metodo_pago` enum('efectivo','sinpe','tarjeta','transferencia') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `garantia_dias` int DEFAULT '0',
  `observaciones_finales` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `calificacion` tinyint DEFAULT NULL,
  `comentario_satisfaccion` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `visita_contada` tinyint(1) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `tenant_id` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ordenes_trabajo_tenant` (`tenant_id`,`numero_orden`),
  KEY `moto_id` (`vehiculo_id`),
  KEY `cliente_id` (`cliente_id`),
  KEY `recepcionista_id` (`recepcionista_id`),
  KEY `tecnico_id` (`tecnico_id`),
  KEY `fk_ordenes_sucursal` (`sucursal_id`),
  KEY `idx_ordenes_trabajo_tenant` (`tenant_id`),
  CONSTRAINT `fk_ordenes_sucursal` FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales` (`id`),
  CONSTRAINT `fk_ordenes_trabajo_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `ordenes_trabajo_ibfk_1` FOREIGN KEY (`vehiculo_id`) REFERENCES `vehiculos` (`id`),
  CONSTRAINT `ordenes_trabajo_ibfk_2` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`),
  CONSTRAINT `ordenes_trabajo_ibfk_3` FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales` (`id`),
  CONSTRAINT `ordenes_trabajo_ibfk_4` FOREIGN KEY (`recepcionista_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `ordenes_trabajo_ibfk_5` FOREIGN KEY (`tecnico_id`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ordenes_trabajo`
--

LOCK TABLES `ordenes_trabajo` WRITE;
/*!40000 ALTER TABLE `ordenes_trabajo` DISABLE KEYS */;
/*!40000 ALTER TABLE `ordenes_trabajo` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `password_reset_codes`
--

DROP TABLE IF EXISTS `password_reset_codes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `password_reset_codes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `cliente_id` int NOT NULL,
  `code_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `expires_at` datetime NOT NULL,
  `used` tinyint(1) DEFAULT '0',
  `attempts` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `tenant_id` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cliente` (`cliente_id`),
  KEY `idx_password_reset_codes_tenant` (`tenant_id`),
  CONSTRAINT `fk_password_reset_codes_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `password_reset_codes_ibfk_1` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `password_reset_codes`
--

LOCK TABLES `password_reset_codes` WRITE;
/*!40000 ALTER TABLE `password_reset_codes` DISABLE KEYS */;
/*!40000 ALTER TABLE `password_reset_codes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `plataforma_admins`
--

DROP TABLE IF EXISTS `plataforma_admins`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `plataforma_admins` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `ultimo_acceso` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_plataforma_email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `plataforma_admins`
--

LOCK TABLES `plataforma_admins` WRITE;
/*!40000 ALTER TABLE `plataforma_admins` DISABLE KEYS */;
-- (las cuentas de Motiq no se exportan: creá la tuya con `npm run motiq:admin`)
/*!40000 ALTER TABLE `plataforma_admins` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `promos`
--

DROP TABLE IF EXISTS `promos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `promos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `titulo` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `descripcion` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `descuento` int DEFAULT '0',
  `imagen` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `precio_final` int DEFAULT NULL,
  `activa` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `tenant_id` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_promos_tenant` (`tenant_id`),
  CONSTRAINT `fk_promos_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `promos`
--

LOCK TABLES `promos` WRITE;
/*!40000 ALTER TABLE `promos` DISABLE KEYS */;
/*!40000 ALTER TABLE `promos` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `recompensas_canjeadas`
--

DROP TABLE IF EXISTS `recompensas_canjeadas`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `recompensas_canjeadas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `cliente_id` int NOT NULL,
  `orden_id` int DEFAULT NULL,
  `aplicado_por` int DEFAULT NULL,
  `descripcion` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Servicio de cortesía',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `tenant_id` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_rc_cliente` (`cliente_id`),
  KEY `aplicado_por` (`aplicado_por`),
  KEY `idx_recompensas_canjeadas_tenant` (`tenant_id`),
  CONSTRAINT `fk_recompensas_canjeadas_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `recompensas_canjeadas_ibfk_1` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`),
  CONSTRAINT `recompensas_canjeadas_ibfk_2` FOREIGN KEY (`aplicado_por`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `recompensas_canjeadas`
--

LOCK TABLES `recompensas_canjeadas` WRITE;
/*!40000 ALTER TABLE `recompensas_canjeadas` DISABLE KEYS */;
/*!40000 ALTER TABLE `recompensas_canjeadas` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `servicios`
--

DROP TABLE IF EXISTS `servicios`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `servicios` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `orden` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `tenant_id` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_servicios_tenant` (`tenant_id`,`nombre`),
  KEY `idx_servicios_tenant` (`tenant_id`),
  CONSTRAINT `fk_servicios_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=588 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `servicios`
--

LOCK TABLES `servicios` WRITE;
/*!40000 ALTER TABLE `servicios` DISABLE KEYS */;
INSERT INTO `servicios` (`id`, `nombre`, `activo`, `orden`, `created_at`, `updated_at`, `tenant_id`) VALUES (1,'Cambio de aceite y filtros',1,1,'2026-08-11 23:49:09','2026-08-11 23:49:09',1),(2,'Revisión completa',1,2,'2026-08-11 23:49:09','2026-08-11 23:49:09',1),(3,'Cambio de pastillas de freno',1,3,'2026-08-11 23:49:09','2026-08-11 23:49:09',1),(4,'Kit de transmisión (cadena y piñones)',1,4,'2026-08-11 23:49:09','2026-08-11 23:49:09',1),(5,'Diagnóstico electrónico',1,5,'2026-08-11 23:49:09','2026-08-11 23:49:09',1),(6,'Cambio de neumáticos',1,6,'2026-08-11 23:49:09','2026-08-11 23:49:09',1),(7,'Mantenimiento preventivo',1,7,'2026-08-11 23:49:09','2026-08-11 23:49:09',1),(8,'Sistema eléctrico',1,8,'2026-08-11 23:49:09','2026-08-11 23:49:09',1),(9,'Afinamiento',1,9,'2026-08-11 23:49:09','2026-08-11 23:49:09',1),(10,'Otro',1,99,'2026-08-11 23:49:09','2026-08-11 23:49:09',1),(42,'Cambio de aceite y filtros',1,1,'2026-08-12 02:09:32','2026-08-12 02:09:32',2),(43,'Revisión completa',1,2,'2026-08-12 02:09:32','2026-08-12 02:09:32',2),(44,'Cambio de pastillas de freno',1,3,'2026-08-12 02:09:32','2026-08-12 02:09:32',2),(45,'Kit de transmisión (cadena y piñones)',1,4,'2026-08-12 02:09:32','2026-08-12 02:09:32',2),(46,'Diagnóstico electrónico',1,5,'2026-08-12 02:09:32','2026-08-12 02:09:32',2),(47,'Cambio de neumáticos',1,6,'2026-08-12 02:09:32','2026-08-12 02:09:32',2),(48,'Mantenimiento preventivo',1,7,'2026-08-12 02:09:32','2026-08-12 02:09:32',2),(49,'Sistema eléctrico',1,8,'2026-08-12 02:09:32','2026-08-12 02:09:32',2),(50,'Afinamiento',1,9,'2026-08-12 02:09:32','2026-08-12 02:09:32',2),(51,'Otro',1,99,'2026-08-12 02:09:32','2026-08-12 02:09:32',2),(521,'Cambio de aceite y filtros',1,1,'2026-08-12 17:54:49','2026-08-12 17:54:49',35),(522,'Revisión completa',1,2,'2026-08-12 17:54:49','2026-08-12 17:54:49',35),(523,'Cambio de pastillas de freno',1,3,'2026-08-12 17:54:49','2026-08-12 17:54:49',35),(524,'Diagnóstico electrónico',1,4,'2026-08-12 17:54:49','2026-08-12 17:54:49',35),(525,'Cambio de neumáticos',1,5,'2026-08-12 17:54:49','2026-08-12 17:54:49',35),(526,'Mantenimiento preventivo',1,6,'2026-08-12 17:54:49','2026-08-12 17:54:49',35),(527,'Sistema eléctrico',1,7,'2026-08-12 17:54:49','2026-08-12 17:54:49',35),(528,'Afinamiento',1,8,'2026-08-12 17:54:49','2026-08-12 17:54:49',35),(529,'Cambio de bujías',1,9,'2026-08-12 17:54:49','2026-08-12 17:54:49',35),(530,'Alineado y balanceo',1,10,'2026-08-12 17:54:49','2026-08-12 17:54:49',35),(531,'Cambio de correa de distribución',1,11,'2026-08-12 17:54:49','2026-08-12 17:54:49',35),(532,'Recarga de aire acondicionado',1,12,'2026-08-12 17:54:49','2026-08-12 17:54:49',35),(533,'Otro',1,13,'2026-08-12 17:54:49','2026-08-12 17:54:49',35),(534,'Cambio de aceite y filtros',1,1,'2026-08-12 17:54:49','2026-08-12 17:54:49',36),(535,'Revisión completa',1,2,'2026-08-12 17:54:49','2026-08-12 17:54:49',36),(536,'Cambio de pastillas de freno',1,3,'2026-08-12 17:54:49','2026-08-12 17:54:49',36),(537,'Diagnóstico electrónico',1,4,'2026-08-12 17:54:49','2026-08-12 17:54:49',36),(538,'Cambio de neumáticos',1,5,'2026-08-12 17:54:49','2026-08-12 17:54:49',36),(539,'Mantenimiento preventivo',1,6,'2026-08-12 17:54:49','2026-08-12 17:54:49',36),(540,'Sistema eléctrico',1,7,'2026-08-12 17:54:49','2026-08-12 17:54:49',36),(541,'Afinamiento',1,8,'2026-08-12 17:54:49','2026-08-12 17:54:49',36),(542,'Cambio de bujías',1,9,'2026-08-12 17:54:49','2026-08-12 17:54:49',36),(543,'Alineado y balanceo',1,10,'2026-08-12 17:54:49','2026-08-12 17:54:49',36),(544,'Cambio de correa de distribución',1,11,'2026-08-12 17:54:49','2026-08-12 17:54:49',36),(545,'Recarga de aire acondicionado',1,12,'2026-08-12 17:54:49','2026-08-12 17:54:49',36),(546,'Otro',1,13,'2026-08-12 17:54:49','2026-08-12 17:54:49',36),(547,'Cambio de aceite y filtros',1,1,'2026-08-12 17:54:50','2026-08-12 17:54:50',37),(548,'Revisión completa',1,2,'2026-08-12 17:54:50','2026-08-12 17:54:50',37),(549,'Cambio de pastillas de freno',1,3,'2026-08-12 17:54:50','2026-08-12 17:54:50',37),(550,'Diagnóstico electrónico',1,4,'2026-08-12 17:54:50','2026-08-12 17:54:50',37),(551,'Cambio de neumáticos',1,5,'2026-08-12 17:54:50','2026-08-12 17:54:50',37),(552,'Mantenimiento preventivo',1,6,'2026-08-12 17:54:50','2026-08-12 17:54:50',37),(553,'Sistema eléctrico',1,7,'2026-08-12 17:54:50','2026-08-12 17:54:50',37),(554,'Afinamiento',1,8,'2026-08-12 17:54:50','2026-08-12 17:54:50',37),(555,'Kit de transmisión (cadena y piñones)',1,9,'2026-08-12 17:54:50','2026-08-12 17:54:50',37),(556,'Ajuste de frenos y suspensión',1,10,'2026-08-12 17:54:50','2026-08-12 17:54:50',37),(557,'Otro',1,11,'2026-08-12 17:54:50','2026-08-12 17:54:50',37),(558,'Kit de transmisión (cadena y piñones)',1,4,'2026-08-12 17:55:04','2026-08-12 17:55:04',36),(559,'Kit de transmisión (cadena y piñones)',1,4,'2026-08-12 17:55:04','2026-08-12 17:55:04',35),(561,'Cambio de aceite y filtros',1,1,'2026-08-12 17:55:14','2026-08-12 17:55:14',38),(562,'Revisión completa',1,2,'2026-08-12 17:55:14','2026-08-12 17:55:14',38),(563,'Cambio de pastillas de freno',1,3,'2026-08-12 17:55:14','2026-08-12 17:55:14',38),(564,'Diagnóstico electrónico',1,4,'2026-08-12 17:55:14','2026-08-12 17:55:14',38),(565,'Cambio de neumáticos',1,5,'2026-08-12 17:55:14','2026-08-12 17:55:14',38),(566,'Mantenimiento preventivo',1,6,'2026-08-12 17:55:14','2026-08-12 17:55:14',38),(567,'Sistema eléctrico',1,7,'2026-08-12 17:55:14','2026-08-12 17:55:14',38),(568,'Afinamiento',1,8,'2026-08-12 17:55:14','2026-08-12 17:55:14',38),(569,'Kit de transmisión (cadena y piñones)',1,9,'2026-08-12 17:55:14','2026-08-12 17:55:14',38),(570,'Ajuste de frenos y suspensión',1,10,'2026-08-12 17:55:14','2026-08-12 17:55:14',38),(571,'Otro',1,11,'2026-08-12 17:55:14','2026-08-12 17:55:14',38),(575,'Cambio de aceite y filtros',1,1,'2026-08-12 17:57:43','2026-08-12 17:57:43',39),(576,'Revisión completa',1,2,'2026-08-12 17:57:43','2026-08-12 17:57:43',39),(577,'Cambio de pastillas de freno',1,3,'2026-08-12 17:57:43','2026-08-12 17:57:43',39),(578,'Diagnóstico electrónico',1,4,'2026-08-12 17:57:43','2026-08-12 17:57:43',39),(579,'Cambio de neumáticos',1,5,'2026-08-12 17:57:43','2026-08-12 17:57:43',39),(580,'Mantenimiento preventivo',1,6,'2026-08-12 17:57:43','2026-08-12 17:57:43',39),(581,'Sistema eléctrico',1,7,'2026-08-12 17:57:43','2026-08-12 17:57:43',39),(582,'Afinamiento',1,8,'2026-08-12 17:57:43','2026-08-12 17:57:43',39),(583,'Cambio de bujías',1,9,'2026-08-12 17:57:43','2026-08-12 17:57:43',39),(584,'Alineado y balanceo',1,10,'2026-08-12 17:57:43','2026-08-12 17:57:43',39),(585,'Cambio de correa de distribución',1,11,'2026-08-12 17:57:43','2026-08-12 17:57:43',39),(586,'Recarga de aire acondicionado',1,12,'2026-08-12 17:57:43','2026-08-12 17:57:43',39),(587,'Otro',1,13,'2026-08-12 17:57:43','2026-08-12 17:57:43',39);
/*!40000 ALTER TABLE `servicios` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `sucursales`
--

DROP TABLE IF EXISTS `sucursales`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sucursales` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `direccion` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `telefono` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `activa` tinyint(1) DEFAULT '1',
  `orden` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `tenant_id` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sucursales_tenant` (`tenant_id`),
  CONSTRAINT `fk_sucursales_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=40 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sucursales`
--

LOCK TABLES `sucursales` WRITE;
/*!40000 ALTER TABLE `sucursales` DISABLE KEYS */;
INSERT INTO `sucursales` (`id`, `nombre`, `direccion`, `telefono`, `activa`, `orden`, `created_at`, `updated_at`, `tenant_id`) VALUES (1,'Liberia',NULL,NULL,1,1,'2026-08-11 23:48:52','2026-08-11 23:48:52',1),(2,'Cañas',NULL,NULL,1,2,'2026-08-11 23:48:52','2026-08-11 23:48:52',1),(35,'Autos Premium',NULL,NULL,1,1,'2026-08-12 17:54:49','2026-08-12 17:54:49',35),(36,'Taller Solo Autos',NULL,NULL,1,1,'2026-08-12 17:54:49','2026-08-12 17:54:49',36),(37,'Sede Central','Calle Falsa 123','2222-0000',1,1,'2026-08-12 17:54:50','2026-08-12 17:54:50',37),(38,'Sede Central','Calle Falsa 123','2222-0000',1,1,'2026-08-12 17:55:14','2026-08-12 17:55:14',38),(39,'Autos Web 451627',NULL,NULL,1,1,'2026-08-12 17:57:43','2026-08-12 17:57:43',39);
/*!40000 ALTER TABLE `sucursales` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tareas_mecanico`
--

DROP TABLE IF EXISTS `tareas_mecanico`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tareas_mecanico` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tecnico_id` int NOT NULL,
  `titulo` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `detalle` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `prioridad` enum('baja','normal','alta','urgente') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'normal',
  `hecha` tinyint(1) DEFAULT '0',
  `asignado_por` int DEFAULT NULL,
  `vence` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `tenant_id` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tarea_tecnico` (`tecnico_id`),
  KEY `asignado_por` (`asignado_por`),
  KEY `idx_tareas_mecanico_tenant` (`tenant_id`),
  CONSTRAINT `fk_tareas_mecanico_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `tareas_mecanico_ibfk_1` FOREIGN KEY (`tecnico_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `tareas_mecanico_ibfk_2` FOREIGN KEY (`asignado_por`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tareas_mecanico`
--

LOCK TABLES `tareas_mecanico` WRITE;
/*!40000 ALTER TABLE `tareas_mecanico` DISABLE KEYS */;
/*!40000 ALTER TABLE `tareas_mecanico` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tenants`
--

DROP TABLE IF EXISTS `tenants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tenants` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `slug` varchar(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'subdominio/identificador publico',
  `plan` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'trial',
  `estado` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'activo' COMMENT 'activo|suspendido|cancelado',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `motivo_estado` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Por que se suspendio o reactivo (lo escribe el admin de Motiq)',
  `trial_hasta` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tenant_slug` (`slug`),
  KEY `idx_tenants_estado` (`estado`)
) ENGINE=InnoDB AUTO_INCREMENT=40 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tenants`
--

LOCK TABLES `tenants` WRITE;
/*!40000 ALTER TABLE `tenants` DISABLE KEYS */;
INSERT INTO `tenants` (`id`, `nombre`, `slug`, `plan`, `estado`, `created_at`, `updated_at`, `motivo_estado`, `trial_hasta`) VALUES (1,'MS Motors','ms-motors','pro','activo','2026-08-12 00:29:01','2026-08-12 00:29:01',NULL,NULL),(2,'Moto Zone','moto-zone','trial','activo','2026-08-12 01:46:08','2026-08-12 17:56:03',NULL,NULL),(35,'Autos Premium','marca-289201','trial','activo','2026-08-12 17:54:49','2026-08-12 17:54:49',NULL,NULL),(36,'Taller Solo Autos','autos-289722','trial','activo','2026-08-12 17:54:49','2026-08-12 17:54:49',NULL,NULL),(37,'Taller Prueba','taller-prueba-290086','trial','activo','2026-08-12 17:54:50','2026-08-12 17:54:50',NULL,NULL),(38,'Taller Prueba','taller-prueba-314640','trial','activo','2026-08-12 17:55:14','2026-08-12 17:55:14',NULL,NULL),(39,'Autos Web 451627','autos-web-451627','trial','activo','2026-08-12 17:57:43','2026-08-12 17:57:43',NULL,NULL);
/*!40000 ALTER TABLE `tenants` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `usuarios`
--

DROP TABLE IF EXISTS `usuarios`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `usuarios` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `rol` enum('recepcion','tecnico','admin') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'tecnico',
  `telefono` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `especialidades` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `horario` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sucursal_id` int DEFAULT NULL,
  `activo` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `foto` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `totp_secret` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `totp_activado` tinyint(1) NOT NULL DEFAULT '0',
  `totp_backup` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `totp_ultimo_contador` bigint DEFAULT NULL,
  `tenant_id` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_usuarios_tenant` (`tenant_id`,`email`),
  KEY `fk_usuarios_sucursal` (`sucursal_id`),
  KEY `idx_usuarios_tenant` (`tenant_id`),
  CONSTRAINT `fk_usuarios_sucursal` FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales` (`id`),
  CONSTRAINT `fk_usuarios_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `usuarios_ibfk_1` FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=43 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `usuarios`
--

LOCK TABLES `usuarios` WRITE;
/*!40000 ALTER TABLE `usuarios` DISABLE KEYS */;
INSERT INTO `usuarios` (`id`, `nombre`, `email`, `password_hash`, `rol`, `telefono`, `especialidades`, `horario`, `sucursal_id`, `activo`, `created_at`, `updated_at`, `foto`, `totp_secret`, `totp_activado`, `totp_backup`, `totp_ultimo_contador`, `tenant_id`) VALUES (1,'Administrador','admin@taller.com','$2b$10$sFrG6pTctxPrAEbZ.9s6sOAwdddSVgyBTNz7bLW5sY3atgqrMT7h2','admin',NULL,NULL,NULL,NULL,1,'2026-08-11 23:48:53','2026-08-11 23:48:53',NULL,NULL,0,NULL,NULL,1),(2,'Recepción','recepcion@taller.com','$2b$10$zQQc0arTvE19uB5Dgq0.7.rtY4ENRhmtkYbzSwqkQLeZaPwZjhJz6','recepcion',NULL,NULL,NULL,NULL,1,'2026-08-11 23:48:53','2026-08-11 23:48:53',NULL,NULL,0,NULL,NULL,1),(5,'Admin Zone','admin@taller.com','$2b$10$k42ivd3qsBrA0YLrBdPq1ujvtCmJlPrTFmIXtWWlyIPNyQowhPj3e','admin',NULL,NULL,NULL,NULL,1,'2026-08-12 01:46:08','2026-08-12 01:46:30',NULL,NULL,0,NULL,NULL,2),(38,'Dueño','marca-289201@t.com','$2b$10$nSI3RWPfYWtFeZ4.FW2fS.yikEgKgmtuDu848NVoc0JelJlTMvtMy','admin',NULL,NULL,NULL,NULL,1,'2026-08-12 17:54:49','2026-08-12 17:54:49',NULL,NULL,0,NULL,NULL,35),(39,'Dueño Autos','duenio-autos-289722@t.com','$2b$10$uHK1pe92CGNZz78iAgHE/ef5676vC9ez6XoaJs/5jXr.9dAaltc6m','admin',NULL,NULL,NULL,NULL,1,'2026-08-12 17:54:49','2026-08-12 17:54:49',NULL,NULL,0,NULL,NULL,36),(40,'Dueño Prueba','duenio-290086@t.com','$2b$10$CAT3ZgLYrJSBYHtn1RzlXev.M9hoDUHL3315bVUjo3XAzLFD5H.pq','admin','8888-0000',NULL,NULL,NULL,1,'2026-08-12 17:54:50','2026-08-12 17:54:50',NULL,NULL,0,NULL,NULL,37),(41,'Dueño Prueba','duenio-314640@t.com','$2b$10$G25KGyo/TjxU1yaSXAgl9uNieIG4pJY07Hz9tk5qarievbghwdT2e','admin','8888-0000',NULL,NULL,NULL,1,'2026-08-12 17:55:14','2026-08-12 17:55:14',NULL,NULL,0,NULL,NULL,38),(42,'Dueño Autos Web','autos-web-451627@t.com','$2b$10$ITQLrJu7lC88W5RKhQI2a.XrJXV2hx2dSDSYQEp0C4JpR7IfBqVWO','admin',NULL,NULL,NULL,NULL,1,'2026-08-12 17:57:43','2026-08-12 17:57:43',NULL,NULL,0,NULL,NULL,39);
/*!40000 ALTER TABLE `usuarios` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `vehiculos`
--

DROP TABLE IF EXISTS `vehiculos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `vehiculos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `cliente_id` int NOT NULL,
  `tipo` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `marca` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `modelo` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `anio` year DEFAULT NULL,
  `placa` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `color` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `numero_motor` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `numero_chasis` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `kilometraje_actual` int DEFAULT '0',
  `foto_url` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `activa` tinyint(1) DEFAULT '1',
  `placa_norm` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci GENERATED ALWAYS AS (upper(replace(replace(`placa`,_utf8mb4' ',_utf8mb4''),_utf8mb4'-',_utf8mb4''))) STORED,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `foto` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `tenant_id` int NOT NULL,
  `atributos` json DEFAULT NULL COMMENT 'Campos propios del tipo (ver utils/tipos-vehiculo.js)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_vehiculos_tenant` (`tenant_id`,`placa_norm`),
  KEY `cliente_id` (`cliente_id`),
  KEY `idx_vehiculos_tenant` (`tenant_id`),
  KEY `idx_vehiculos_tipo` (`tenant_id`,`tipo`),
  CONSTRAINT `fk_motos_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `vehiculos_ibfk_1` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=35 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `vehiculos`
--

LOCK TABLES `vehiculos` WRITE;
/*!40000 ALTER TABLE `vehiculos` DISABLE KEYS */;
INSERT INTO `vehiculos` (`id`, `cliente_id`, `tipo`, `marca`, `modelo`, `anio`, `placa`, `color`, `numero_motor`, `numero_chasis`, `kilometraje_actual`, `foto_url`, `activa`, `created_at`, `updated_at`, `foto`, `tenant_id`, `atributos`) VALUES (29,1,'moto','Honda','CB125',NULL,'ABC-123',NULL,NULL,NULL,0,NULL,1,'2026-08-12 17:22:00','2026-08-12 17:22:00',NULL,1,NULL),(30,2,'moto','Yamaha','FZ',NULL,'ABC-123',NULL,NULL,NULL,0,NULL,1,'2026-08-12 17:22:00','2026-08-12 17:22:00',NULL,2,NULL),(31,32,'auto','Toyota','Corolla',NULL,'AUT-722',NULL,NULL,NULL,0,NULL,1,'2026-08-12 17:54:49','2026-08-12 17:54:49',NULL,36,'{\"puertas\": 4, \"carroceria\": \"Sedán\", \"combustible\": \"Gasolina\", \"transmision\": \"Automática\"}'),(32,32,'auto','Nissan','Versa',NULL,'XXX-722',NULL,NULL,NULL,0,NULL,1,'2026-08-12 17:54:49','2026-08-12 17:54:49',NULL,36,NULL),(33,1,'moto','Honda','CB125',NULL,'A4B-465',NULL,NULL,NULL,0,NULL,1,'2026-08-12 17:56:00','2026-08-12 17:56:00',NULL,1,NULL),(34,2,'moto','Yamaha','FZ',NULL,'A4B-465',NULL,NULL,NULL,0,NULL,1,'2026-08-12 17:56:00','2026-08-12 17:56:00',NULL,2,NULL);
/*!40000 ALTER TABLE `vehiculos` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `web_vitals`
--

DROP TABLE IF EXISTS `web_vitals`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `web_vitals` (
  `id` int NOT NULL AUTO_INCREMENT,
  `metrica` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `valor` double NOT NULL,
  `calificacion` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ruta` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `movil` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `tenant_id` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_wv_metrica` (`metrica`,`created_at`),
  KEY `idx_wv_ruta` (`ruta`),
  KEY `idx_web_vitals_tenant` (`tenant_id`),
  CONSTRAINT `fk_web_vitals_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `web_vitals`
--

LOCK TABLES `web_vitals` WRITE;
/*!40000 ALTER TABLE `web_vitals` DISABLE KEYS */;
/*!40000 ALTER TABLE `web_vitals` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping routines for database 'sasstaller'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-08-12 11:58:37
