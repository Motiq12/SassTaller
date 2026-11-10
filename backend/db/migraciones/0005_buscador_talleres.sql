-- Buscador de talleres: la ubicación va en cada sucursal, porque un taller con locales
-- en dos cantones tiene que aparecer en los dos. Aparecer es decisión de cada empresa:
-- el valor por defecto es 0, así que ningún taller que ya existía sale en un directorio
-- público sin haberlo activado.
ALTER TABLE "sucursales"
  ADD COLUMN "provincia" varchar(30) DEFAULT NULL,
  ADD COLUMN "canton" varchar(60) DEFAULT NULL;
CREATE INDEX "idx_sucursales_ubicacion" ON "sucursales" ("provincia", "canton");

ALTER TABLE "configuracion" ADD COLUMN "visible_buscador" smallint NOT NULL DEFAULT 0;
