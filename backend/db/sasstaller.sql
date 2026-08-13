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
  `es_ejemplo` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_citas_orden` (`orden_id`),
  KEY `idx_citas_sucursal_fecha_hora` (`sucursal_id`,`fecha`,`hora`),
  KEY `cliente_id` (`cliente_id`),
  KEY `usuario_id` (`usuario_id`),
  KEY `fk_citas_tecnico` (`tecnico_id`),
  KEY `idx_citas_tenant` (`tenant_id`),
  KEY `idx_citas_tenant_fecha` (`tenant_id`,`fecha`,`hora`),
  KEY `idx_citas_vehiculo` (`vehiculo_id`),
  CONSTRAINT `citas_ibfk_1` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`),
  CONSTRAINT `citas_ibfk_2` FOREIGN KEY (`vehiculo_id`) REFERENCES `vehiculos` (`id`),
  CONSTRAINT `citas_ibfk_3` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`),
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
INSERT INTO `citas` (`id`, `cliente_id`, `vehiculo_id`, `usuario_id`, `tecnico_id`, `sucursal_id`, `fecha`, `hora`, `motivo`, `tipo_servicio`, `estado`, `monto`, `calificacion`, `comentario_satisfaccion`, `fecha_inicio`, `fecha_fin`, `hora_llegada`, `orden_id`, `created_at`, `updated_at`, `confirmada_cliente`, `fecha_listo`, `recordatorio_enviado`, `no_show`, `fecha_cancelacion`, `tenant_id`, `es_ejemplo`) VALUES (1,1,NULL,NULL,NULL,1,'2026-08-20','09:00:00','CITA-DEL-TALLER-1',NULL,'agendado',0.00,NULL,NULL,NULL,NULL,NULL,NULL,'2026-08-12 01:46:08','2026-08-12 01:47:06',0,NULL,0,0,NULL,1,0),(2,2,NULL,NULL,NULL,1,'2026-08-20','10:00:00','CITA-DEL-TALLER-2',NULL,'agendado',0.00,NULL,NULL,NULL,NULL,NULL,NULL,'2026-08-12 01:46:08','2026-08-12 01:47:06',0,NULL,0,0,NULL,2,0);
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
  `es_ejemplo` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_clientes_tenant` (`tenant_id`),
  KEY `idx_clientes_tenant_nombre` (`tenant_id`,`activo`,`nombre`,`apellido`),
  CONSTRAINT `fk_clientes_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=59 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `clientes`
--

LOCK TABLES `clientes` WRITE;
/*!40000 ALTER TABLE `clientes` DISABLE KEYS */;
INSERT INTO `clientes` (`id`, `nombre`, `apellido`, `telefono`, `email`, `cedula`, `direccion`, `password_hash`, `visitas`, `cortesia_disponible`, `notif_avances`, `notif_recordatorios`, `activo`, `created_at`, `updated_at`, `foto`, `email_verificado`, `email_pendiente`, `tenant_id`, `es_ejemplo`) VALUES (1,'Cliente','DelUno','111-1111',NULL,NULL,NULL,NULL,0,0,1,1,1,'2026-08-12 01:46:08','2026-08-12 01:46:08',NULL,1,NULL,1,0),(2,'Cliente','DelDos','222-2222',NULL,NULL,NULL,NULL,0,0,1,1,1,'2026-08-12 01:46:08','2026-08-12 01:46:08',NULL,1,NULL,2,0),(33,'Ana','Uno','8888-1111','cliente-1786557361919@t.com','1-2222-3333',NULL,'$2b$10$KPp0s9ggMXn4MOjS.WoeQu4u8QEiP5yWCmZxhF1PGLrsVlBDhnlQG',0,0,1,1,1,'2026-08-12 17:56:02','2026-08-12 17:56:02',NULL,1,NULL,1,0),(34,'Ana','Dos','8888-2222','cliente-1786557361919@t.com','1-2222-3333',NULL,'$2b$10$Yg7X/bHUL7tSUtt7YqIE8OU7xMSml.3ZAbeE773KpZW.bOpfld8vG',0,0,1,1,1,'2026-08-12 17:56:02','2026-08-12 17:56:02',NULL,1,NULL,2,0),(35,'Ana','Uno','8888-1111','cliente-1786558071993@t.com','1-2222-3333',NULL,'$2b$10$S5/aBPEfW9FuNSpIPMIsF.E8jGY0x8dOx/Vm6bUBQQFIbDBtCXipu',0,0,1,1,1,'2026-08-12 18:07:52','2026-08-12 18:07:52',NULL,1,NULL,1,0),(36,'Ana','Dos','8888-2222','cliente-1786558071993@t.com','1-2222-3333',NULL,'$2b$10$phw6cBSlWNsUk/GKYOGySu5uYmDVqsuBxV37aGcojWX8qQKjguUtm',0,0,1,1,1,'2026-08-12 18:07:52','2026-08-12 18:07:52',NULL,1,NULL,2,0),(37,'Ana','Uno','8888-1111','cliente-1786558348758@t.com','1-2222-3333',NULL,'$2b$10$WuyqP/mEwJgZUwedinY/DepPLUMYg38gmPK7QKoApuihKbZP82wom',0,0,1,1,1,'2026-08-12 18:12:28','2026-08-12 18:12:29',NULL,1,NULL,1,0),(38,'Ana','Dos','8888-2222','cliente-1786558348758@t.com','1-2222-3333',NULL,'$2b$10$hUPOgPeSMZX.0qD1wxx1e.OTzjgicFU8.0V6.R56gYCN5yGg8Fp5W',0,0,1,1,1,'2026-08-12 18:12:28','2026-08-12 18:12:29',NULL,1,NULL,2,0),(40,'Ana','Uno','8888-1111','cliente-1786563032083@t.com','1-2222-3333',NULL,'$2b$10$LYO49yE7SK6/c1Bqtk56ZOzXs7eOAn6eOmrcRv6am.SvtDn76ArQS',0,0,1,1,1,'2026-08-12 19:30:32','2026-08-12 19:30:32',NULL,1,NULL,1,0),(41,'Ana','Dos','8888-2222','cliente-1786563032083@t.com','1-2222-3333',NULL,'$2b$10$WH.FvMtHKr.dD4TE02ya0eoL0RELLN9sBHxJQeCsghXJT2snLfioO',0,0,1,1,1,'2026-08-12 19:30:32','2026-08-12 19:30:32',NULL,1,NULL,2,0),(44,'Ana','Uno','8888-1111','cliente-1786564589328@t.com','1-2222-3333',NULL,'$2b$10$mJ6lOjunDUGrthYTLXs4CuG9a2FwWVp2z/BJf5QjfUUF41BjASR2m',0,0,1,1,1,'2026-08-12 19:56:29','2026-08-12 19:56:29',NULL,1,NULL,1,0),(45,'Ana','Dos','8888-2222','cliente-1786564589328@t.com','1-2222-3333',NULL,'$2b$10$MHGBN9RF0d6gEDEA7gJJ6ec7tfGd9kZoKBB.XFrE81uJ3fZWEZRqW',0,0,1,1,1,'2026-08-12 19:56:29','2026-08-12 19:56:29',NULL,1,NULL,2,0),(46,'Ana','Uno','8888-1111','cliente-1786572350264@t.com','1-2222-3333',NULL,'$2b$10$.dt0dodyKrEsiLiWOtEuoOF9Z0vIH304L0ABaFzB5FIZ0DQDv9ZD6',0,0,1,1,1,'2026-08-12 22:05:50','2026-08-12 22:05:51',NULL,1,NULL,1,0),(47,'Ana','Dos','8888-2222','cliente-1786572350264@t.com','1-2222-3333',NULL,'$2b$10$60P2lVxGv3ucvd5r/agAw.5oUD2tIWelBFxz5MlyzRR.G3hI2tIm2',0,0,1,1,1,'2026-08-12 22:05:50','2026-08-12 22:05:51',NULL,1,NULL,2,0),(48,'Ana','Uno','8888-1111','cliente-1786572579853@t.com','1-2222-3333',NULL,'$2b$10$Pj9dcMm8Q1dMAqPW2OD54.tg72gtzc47w26hq23cqWjXoNU.B/FgW',0,0,1,1,1,'2026-08-12 22:09:39','2026-08-12 22:09:40',NULL,1,NULL,1,0),(49,'Ana','Dos','8888-2222','cliente-1786572579853@t.com','1-2222-3333',NULL,'$2b$10$hBFbZpfkaAdT4oyWiSVBZubabH6iGeJdwtTQv33rYV12U4NjjWK4m',0,0,1,1,1,'2026-08-12 22:09:40','2026-08-12 22:09:40',NULL,1,NULL,2,0),(54,'Ana','Uno','8888-1111','cliente-1786578529261@t.com','1-2222-3333',NULL,'$2b$10$rldY1ceXNkONHMykq6F.X.u4GrA6SMqTXkaf7kI42REd4RRpRAS2G',0,0,1,1,1,'2026-08-12 23:48:49','2026-08-12 23:48:49',NULL,1,NULL,1,0),(55,'Ana','Dos','8888-2222','cliente-1786578529261@t.com','1-2222-3333',NULL,'$2b$10$5CWt2X1CKOgxd3MDb4e1rO9ctr/gXJx8KTZbad9dQzojigtHwzE4W',0,0,1,1,1,'2026-08-12 23:48:49','2026-08-12 23:48:49',NULL,1,NULL,2,0),(56,'Ana','Uno','8888-1111','cliente-1786580238153@t.com','1-2222-3333',NULL,'$2b$10$JnzvlddvdxlKtGPnNUN11OLRwleLqTjlybDYQ14zEa7ILGkLHHG2a',0,0,1,1,1,'2026-08-13 00:17:18','2026-08-13 00:17:18',NULL,1,NULL,1,0),(57,'Ana','Dos','8888-2222','cliente-1786580238153@t.com','1-2222-3333',NULL,'$2b$10$33l6SQJJRCnr62JdJwsn3ed9HxbLM061YBOmWWluWMlAKZjoKwhES',0,0,1,1,1,'2026-08-13 00:17:18','2026-08-13 00:17:18',NULL,1,NULL,2,0);
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
  `arranque_oculto` tinyint(1) NOT NULL DEFAULT '0',
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
INSERT INTO `configuracion` (`id`, `nombre_taller`, `telefono`, `email`, `direccion`, `logo`, `max_citas_hora`, `dias_anticipacion`, `duracion_cita_min`, `horarios`, `notif_estado`, `notif_recordatorio`, `notif_cotizacion`, `notif_email_entrega`, `updated_at`, `cancelacion_horas_min`, `visitas_para_cortesia`, `zona_horaria_offset`, `garantia_dias`, `metodos_pago`, `tenant_id`, `tipos_vehiculo`, `color_primario`, `arranque_oculto`) VALUES (1,'MS Motos','','','',NULL,2,30,90,'[{\"dia\": 0, \"abre\": \"08:00\", \"activo\": 0, \"cierra\": \"13:00\"}, {\"dia\": 1, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 2, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 3, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 4, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 5, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"17:00\"}, {\"dia\": 6, \"abre\": \"08:00\", \"activo\": 1, \"cierra\": \"13:00\"}]',1,1,1,0,'2026-08-12 06:09:57',2,7,-6,30,NULL,1,'[\"moto\"]','#e11d48',0);
/*!40000 ALTER TABLE `configuracion` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `contactos_demo`
--

DROP TABLE IF EXISTS `contactos_demo`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `contactos_demo` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `telefono` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `empresa` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `volumen` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mensaje` text COLLATE utf8mb4_unicode_ci,
  `estado` enum('nuevo','contactado','cerrado','descartado') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'nuevo',
  `nota_interna` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `origen` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_contactos_estado` (`estado`,`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `contactos_demo`
--

LOCK TABLES `contactos_demo` WRITE;
/*!40000 ALTER TABLE `contactos_demo` DISABLE KEYS */;
/*!40000 ALTER TABLE `contactos_demo` ENABLE KEYS */;
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
) ENGINE=InnoDB AUTO_INCREMENT=39 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `email_verify_codes`
--

LOCK TABLES `email_verify_codes` WRITE;
/*!40000 ALTER TABLE `email_verify_codes` DISABLE KEYS */;
INSERT INTO `email_verify_codes` (`id`, `cliente_id`, `code_hash`, `expires_at`, `used`, `attempts`, `created_at`, `proposito`, `tenant_id`) VALUES (21,33,'$2b$10$FQGblzONyjkfhTb9WvpksuKUUuVUg95cnsAdvShCJbZ7crnXDmv3e','2026-08-12 12:06:02',0,0,'2026-08-12 17:56:02','registro',1),(22,34,'$2b$10$NSlpSv84jSxu.ts9vJJR.u3kwQUdBlITJN/6ON2TkRkRrIB7QJFD2','2026-08-12 12:06:02',0,0,'2026-08-12 17:56:02','registro',2),(23,35,'$2b$10$blZvmkInTqi7Xnwp5d4bke2bhMGzA2/vJ6t6CR0B5Yf6BB5.n8OXS','2026-08-12 12:17:52',0,0,'2026-08-12 18:07:52','registro',1),(24,36,'$2b$10$6FaH6R1QvBtSGbdjdhs0meQz.xEET1XdVYsac83rkvjEfg7zttEQm','2026-08-12 12:17:52',0,0,'2026-08-12 18:07:52','registro',2),(25,37,'$2b$10$S8XmNTizBbH3KFzbtSIwPe4qaMmiVk30D0aspmAriD0pQu0yJJxyW','2026-08-12 12:22:28',0,0,'2026-08-12 18:12:28','registro',1),(26,38,'$2b$10$irUwsY1tpbBuZH3thh1s3.pdKeBtGfLTAXE3napvL.Z5wwRoUhzKe','2026-08-12 12:22:29',0,0,'2026-08-12 18:12:29','registro',2),(27,40,'$2b$10$O6y9fAd7JGgszvOly.UIluYNQBey/MxA8fOeQiwvbUt9rv5o4c1Ou','2026-08-12 13:40:32',0,0,'2026-08-12 19:30:32','registro',1),(28,41,'$2b$10$RAYqIWE1gy8nvfOaq8nxZ.zVn.LGNFDgad7Gx1seASuniwTz2vhju','2026-08-12 13:40:32',0,0,'2026-08-12 19:30:32','registro',2),(29,44,'$2b$10$WrchX7x9CdiF8Ofz6lKVWuH2I7HRiI5AAto7ZBObhx2pGCrkmxZVe','2026-08-12 14:06:29',0,0,'2026-08-12 19:56:29','registro',1),(30,45,'$2b$10$MLekTDaV42efvttQHwU5wOJS9p1EIgYatNuU9/ST/7B7RpMEWQdlm','2026-08-12 14:06:29',0,0,'2026-08-12 19:56:29','registro',2),(31,46,'$2b$10$Bw5CQB3nRajnn/Z5NvBQQO4nsN6urnVB5mLpKZCVKxJB/dz7uBG9G','2026-08-12 16:15:50',0,0,'2026-08-12 22:05:50','registro',1),(32,47,'$2b$10$lny23i3LU.IBiIOZx4dc3.9VYDJQyh5nlO0F/GAnUMVpW5eAiJHk.','2026-08-12 16:15:50',0,0,'2026-08-12 22:05:50','registro',2),(33,48,'$2b$10$W0F4B/agb2gPevBthLQZjuT0m4iLzaR8tC3KBwwoj6YF3tGiS2.4W','2026-08-12 16:19:40',0,0,'2026-08-12 22:09:40','registro',1),(34,49,'$2b$10$.3bvHv2UASQk34HWCuQ53.pVV9JtIolX.ZRlMKfqYVfX3/qsk14hu','2026-08-12 16:19:40',0,0,'2026-08-12 22:09:40','registro',2),(35,54,'$2b$10$VjDM5DwYXKXcdAhDuv0S2e3AWIcP51b8FYD7CRVF9VUUi7824xD7C','2026-08-12 17:58:49',0,0,'2026-08-12 23:48:49','registro',1),(36,55,'$2b$10$2hM3cDEBpPFaX2q3a16TA.1Bq9.sppfpjjo2UrhMCmJbFIvVjtwpW','2026-08-12 17:58:49',0,0,'2026-08-12 23:48:49','registro',2),(37,56,'$2b$10$SR.eV6fnUVBPh7AfO9cN6uyY615K8VbNay4K3lslu8m/YBsecFyJy','2026-08-12 18:27:18',0,0,'2026-08-13 00:17:18','registro',1),(38,57,'$2b$10$h5zeAr7fSg51Uv.Og1rETeh.TRnfHm/nvGMSx/hZxmr2O/XFJVe8C','2026-08-12 18:27:18',0,0,'2026-08-13 00:17:18','registro',2);
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
  KEY `idx_mensaje_lecturas_tenant` (`tenant_id`),
  KEY `idx_ml_tenant_usuario` (`tenant_id`,`usuario_id`),
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
  KEY `idx_msg_destino_created` (`destino_id`,`created_at`),
  KEY `idx_mensajes_internos_tenant` (`tenant_id`),
  KEY `idx_msg_tenant_broadcast` (`tenant_id`,`tipo`,`destino_rol`,`created_at`),
  KEY `idx_msg_tenant_sucursal` (`tenant_id`,`sucursal_id`),
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
-- Table structure for table `motiq_bitacora`
--

DROP TABLE IF EXISTS `motiq_bitacora`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `motiq_bitacora` (
  `id` int NOT NULL AUTO_INCREMENT,
  `admin_id` int DEFAULT NULL,
  `admin_email` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `accion` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` int DEFAULT NULL,
  `tenant_slug` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `detalle` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_bitacora_admin` (`admin_id`,`created_at`),
  KEY `idx_bitacora_fecha` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=24 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `motiq_bitacora`
--

LOCK TABLES `motiq_bitacora` WRITE;
/*!40000 ALTER TABLE `motiq_bitacora` DISABLE KEYS */;
/*!40000 ALTER TABLE `motiq_bitacora` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `motiq_seguidos`
--

DROP TABLE IF EXISTS `motiq_seguidos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `motiq_seguidos` (
  `admin_id` int NOT NULL,
  `tenant_id` int NOT NULL,
  `nota` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`admin_id`,`tenant_id`),
  CONSTRAINT `motiq_seguidos_ibfk_1` FOREIGN KEY (`admin_id`) REFERENCES `plataforma_admins` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `motiq_seguidos`
--

LOCK TABLES `motiq_seguidos` WRITE;
/*!40000 ALTER TABLE `motiq_seguidos` DISABLE KEYS */;
/*!40000 ALTER TABLE `motiq_seguidos` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `motiq_tareas`
--

DROP TABLE IF EXISTS `motiq_tareas`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `motiq_tareas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `admin_id` int NOT NULL,
  `texto` varchar(300) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` int DEFAULT NULL,
  `vence_el` date DEFAULT NULL,
  `hecha` tinyint(1) NOT NULL DEFAULT '0',
  `hecha_en` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tareas_admin` (`admin_id`,`hecha`,`vence_el`),
  CONSTRAINT `motiq_tareas_ibfk_1` FOREIGN KEY (`admin_id`) REFERENCES `plataforma_admins` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `motiq_tareas`
--

LOCK TABLES `motiq_tareas` WRITE;
/*!40000 ALTER TABLE `motiq_tareas` DISABLE KEYS */;
/*!40000 ALTER TABLE `motiq_tareas` ENABLE KEYS */;
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
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
  `es_ejemplo` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ordenes_trabajo_tenant` (`tenant_id`,`numero_orden`),
  KEY `cliente_id` (`cliente_id`),
  KEY `recepcionista_id` (`recepcionista_id`),
  KEY `tecnico_id` (`tecnico_id`),
  KEY `fk_ordenes_sucursal` (`sucursal_id`),
  KEY `idx_ordenes_trabajo_tenant` (`tenant_id`),
  KEY `idx_ordenes_vehiculo` (`vehiculo_id`),
  CONSTRAINT `fk_ordenes_sucursal` FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales` (`id`),
  CONSTRAINT `fk_ordenes_trabajo_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `ordenes_trabajo_ibfk_1` FOREIGN KEY (`vehiculo_id`) REFERENCES `vehiculos` (`id`),
  CONSTRAINT `ordenes_trabajo_ibfk_2` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`),
  CONSTRAINT `ordenes_trabajo_ibfk_3` FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales` (`id`),
  CONSTRAINT `ordenes_trabajo_ibfk_4` FOREIGN KEY (`recepcionista_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `ordenes_trabajo_ibfk_5` FOREIGN KEY (`tecnico_id`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
) ENGINE=InnoDB AUTO_INCREMENT=1054 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `servicios`
--

LOCK TABLES `servicios` WRITE;
/*!40000 ALTER TABLE `servicios` DISABLE KEYS */;
INSERT INTO `servicios` (`id`, `nombre`, `activo`, `orden`, `created_at`, `updated_at`, `tenant_id`) VALUES (1,'Cambio de aceite y filtros',1,1,'2026-08-11 23:49:09','2026-08-11 23:49:09',1),(2,'Revisión completa',1,2,'2026-08-11 23:49:09','2026-08-11 23:49:09',1),(3,'Cambio de pastillas de freno',1,3,'2026-08-11 23:49:09','2026-08-11 23:49:09',1),(4,'Kit de transmisión (cadena y piñones)',1,4,'2026-08-11 23:49:09','2026-08-11 23:49:09',1),(5,'Diagnóstico electrónico',1,5,'2026-08-11 23:49:09','2026-08-11 23:49:09',1),(6,'Cambio de neumáticos',1,6,'2026-08-11 23:49:09','2026-08-11 23:49:09',1),(7,'Mantenimiento preventivo',1,7,'2026-08-11 23:49:09','2026-08-11 23:49:09',1),(8,'Sistema eléctrico',1,8,'2026-08-11 23:49:09','2026-08-11 23:49:09',1),(9,'Afinamiento',1,9,'2026-08-11 23:49:09','2026-08-11 23:49:09',1),(10,'Otro',1,99,'2026-08-11 23:49:09','2026-08-11 23:49:09',1),(42,'Cambio de aceite y filtros',1,1,'2026-08-12 02:09:32','2026-08-12 02:09:32',2),(43,'Revisión completa',1,2,'2026-08-12 02:09:32','2026-08-12 02:09:32',2),(44,'Cambio de pastillas de freno',1,3,'2026-08-12 02:09:32','2026-08-12 02:09:32',2),(45,'Kit de transmisión (cadena y piñones)',1,4,'2026-08-12 02:09:32','2026-08-12 02:09:32',2),(46,'Diagnóstico electrónico',1,5,'2026-08-12 02:09:32','2026-08-12 02:09:32',2),(47,'Cambio de neumáticos',1,6,'2026-08-12 02:09:32','2026-08-12 02:09:32',2),(48,'Mantenimiento preventivo',1,7,'2026-08-12 02:09:32','2026-08-12 02:09:32',2),(49,'Sistema eléctrico',1,8,'2026-08-12 02:09:32','2026-08-12 02:09:32',2),(50,'Afinamiento',1,9,'2026-08-12 02:09:32','2026-08-12 02:09:32',2),(51,'Otro',1,99,'2026-08-12 02:09:32','2026-08-12 02:09:32',2);
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
) ENGINE=InnoDB AUTO_INCREMENT=90 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sucursales`
--

LOCK TABLES `sucursales` WRITE;
/*!40000 ALTER TABLE `sucursales` DISABLE KEYS */;
INSERT INTO `sucursales` (`id`, `nombre`, `direccion`, `telefono`, `activa`, `orden`, `created_at`, `updated_at`, `tenant_id`) VALUES (1,'Liberia',NULL,NULL,1,1,'2026-08-11 23:48:52','2026-08-11 23:48:52',1),(2,'Cañas',NULL,NULL,1,2,'2026-08-11 23:48:52','2026-08-11 23:48:52',1);
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
) ENGINE=InnoDB AUTO_INCREMENT=78 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tenants`
--

LOCK TABLES `tenants` WRITE;
/*!40000 ALTER TABLE `tenants` DISABLE KEYS */;
INSERT INTO `tenants` (`id`, `nombre`, `slug`, `plan`, `estado`, `created_at`, `updated_at`, `motivo_estado`, `trial_hasta`) VALUES (1,'MS Motors','ms-motors','pro','activo','2026-08-12 00:29:01','2026-08-12 00:29:01',NULL,NULL),(2,'Moto Zone','moto-zone','trial','activo','2026-08-12 01:46:08','2026-08-13 00:16:48',NULL,NULL);
/*!40000 ALTER TABLE `tenants` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `usuario_verify_codes`
--

DROP TABLE IF EXISTS `usuario_verify_codes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `usuario_verify_codes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` int NOT NULL,
  `usuario_id` int NOT NULL,
  `code_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expires_at` datetime NOT NULL,
  `used` tinyint(1) NOT NULL DEFAULT '0',
  `attempts` int NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_uvc_usuario` (`usuario_id`),
  KEY `idx_uvc_tenant` (`tenant_id`),
  CONSTRAINT `fk_uvc_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `fk_uvc_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=24 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `usuario_verify_codes`
--

LOCK TABLES `usuario_verify_codes` WRITE;
/*!40000 ALTER TABLE `usuario_verify_codes` DISABLE KEYS */;
/*!40000 ALTER TABLE `usuario_verify_codes` ENABLE KEYS */;
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
  `email_verificado` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_usuarios_tenant` (`tenant_id`,`email`),
  KEY `fk_usuarios_sucursal` (`sucursal_id`),
  KEY `idx_usuarios_tenant` (`tenant_id`),
  CONSTRAINT `fk_usuarios_sucursal` FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales` (`id`),
  CONSTRAINT `fk_usuarios_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `usuarios_ibfk_1` FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=101 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `usuarios`
--

LOCK TABLES `usuarios` WRITE;
/*!40000 ALTER TABLE `usuarios` DISABLE KEYS */;
INSERT INTO `usuarios` (`id`, `nombre`, `email`, `password_hash`, `rol`, `telefono`, `especialidades`, `horario`, `sucursal_id`, `activo`, `created_at`, `updated_at`, `foto`, `totp_secret`, `totp_activado`, `totp_backup`, `totp_ultimo_contador`, `tenant_id`, `email_verificado`) VALUES (1,'Administrador','admin@taller.com','$2b$10$sFrG6pTctxPrAEbZ.9s6sOAwdddSVgyBTNz7bLW5sY3atgqrMT7h2','admin',NULL,NULL,NULL,NULL,1,'2026-08-11 23:48:53','2026-08-11 23:48:53',NULL,NULL,0,NULL,NULL,1,1),(2,'Recepción','recepcion@taller.com','$2b$10$zQQc0arTvE19uB5Dgq0.7.rtY4ENRhmtkYbzSwqkQLeZaPwZjhJz6','recepcion',NULL,NULL,NULL,NULL,1,'2026-08-11 23:48:53','2026-08-11 23:48:53',NULL,NULL,0,NULL,NULL,1,1),(5,'Admin Zone','admin@taller.com','$2b$10$k42ivd3qsBrA0YLrBdPq1ujvtCmJlPrTFmIXtWWlyIPNyQowhPj3e','admin',NULL,NULL,NULL,NULL,1,'2026-08-12 01:46:08','2026-08-12 01:46:30',NULL,NULL,0,NULL,NULL,2,1);
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
  `es_ejemplo` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_vehiculos_tenant` (`tenant_id`,`placa_norm`),
  KEY `cliente_id` (`cliente_id`),
  KEY `idx_vehiculos_tenant` (`tenant_id`),
  KEY `idx_vehiculos_tipo` (`tenant_id`,`tipo`),
  CONSTRAINT `fk_motos_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `vehiculos_ibfk_1` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=57 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `vehiculos`
--

LOCK TABLES `vehiculos` WRITE;
/*!40000 ALTER TABLE `vehiculos` DISABLE KEYS */;
INSERT INTO `vehiculos` (`id`, `cliente_id`, `tipo`, `marca`, `modelo`, `anio`, `placa`, `color`, `numero_motor`, `numero_chasis`, `kilometraje_actual`, `foto_url`, `activa`, `created_at`, `updated_at`, `foto`, `tenant_id`, `atributos`, `es_ejemplo`) VALUES (29,1,'moto','Honda','CB125',NULL,'ABC-123',NULL,NULL,NULL,0,NULL,1,'2026-08-12 17:22:00','2026-08-12 17:22:00',NULL,1,NULL,0),(30,2,'moto','Yamaha','FZ',NULL,'ABC-123',NULL,NULL,NULL,0,NULL,1,'2026-08-12 17:22:00','2026-08-12 17:22:00',NULL,2,NULL,0),(33,1,'moto','Honda','CB125',NULL,'A4B-465',NULL,NULL,NULL,0,NULL,1,'2026-08-12 17:56:00','2026-08-12 17:56:00',NULL,1,NULL,0),(34,2,'moto','Yamaha','FZ',NULL,'A4B-465',NULL,NULL,NULL,0,NULL,1,'2026-08-12 17:56:00','2026-08-12 17:56:00',NULL,2,NULL,0),(35,1,'moto','Honda','CB125',NULL,'A3B-570',NULL,NULL,NULL,0,NULL,1,'2026-08-12 18:12:27','2026-08-12 18:12:27',NULL,1,NULL,0),(36,2,'moto','Yamaha','FZ',NULL,'A3B-570',NULL,NULL,NULL,0,NULL,1,'2026-08-12 18:12:27','2026-08-12 18:12:27',NULL,2,NULL,0),(39,1,'moto','Honda','CB125',NULL,'A5B-375',NULL,NULL,NULL,0,NULL,1,'2026-08-12 19:30:13','2026-08-12 19:30:13',NULL,1,NULL,0),(40,2,'moto','Yamaha','FZ',NULL,'A5B-375',NULL,NULL,NULL,0,NULL,1,'2026-08-12 19:30:13','2026-08-12 19:30:13',NULL,2,NULL,0),(45,1,'moto','Honda','CB125',NULL,'A4B-422',NULL,NULL,NULL,0,NULL,1,'2026-08-12 22:17:28','2026-08-12 22:17:28',NULL,1,NULL,0),(46,2,'moto','Yamaha','FZ',NULL,'A4B-422',NULL,NULL,NULL,0,NULL,1,'2026-08-12 22:17:28','2026-08-12 22:17:28',NULL,2,NULL,0),(52,1,'moto','Honda','CB125',NULL,'A9B-481',NULL,NULL,NULL,0,NULL,1,'2026-08-12 23:48:41','2026-08-12 23:48:41',NULL,1,NULL,0),(53,2,'moto','Yamaha','FZ',NULL,'A9B-481',NULL,NULL,NULL,0,NULL,1,'2026-08-12 23:48:41','2026-08-12 23:48:41',NULL,2,NULL,0),(54,1,'moto','Honda','CB125',NULL,'A9B-806',NULL,NULL,NULL,0,NULL,1,'2026-08-13 00:17:10','2026-08-13 00:17:10',NULL,1,NULL,0),(55,2,'moto','Yamaha','FZ',NULL,'A9B-806',NULL,NULL,NULL,0,NULL,1,'2026-08-13 00:17:10','2026-08-13 00:17:10',NULL,2,NULL,0);
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
  KEY `idx_web_vitals_tenant` (`tenant_id`),
  KEY `idx_wv_tenant_metrica` (`tenant_id`,`metrica`,`created_at`),
  KEY `idx_wv_tenant_ruta` (`tenant_id`,`ruta`),
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

-- Dump completed on 2026-08-12 18:19:37
