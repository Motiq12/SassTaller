-- =============================================================
-- SassTaller — migracion 003: marca propia de cada taller
--
-- El sistema venia con la identidad de MS Motos incrustada: su logo en el panel,
-- su nombre en los titulos y en los comprobantes. Para un SaaS eso es un error de
-- fondo — un taller de autos que se registra entra a un sistema que lleva el
-- nombre de otro taller, competencia suya incluso.
--
-- `nombre_taller` y `logo` ya eran por taller. Falta el color: una empresa grande
-- espera ver SU color, no el carmesi del taller original.
-- =============================================================

-- Color principal en hexadecimal (#rrggbb). NULL = usa el color por defecto del
-- sistema. Se guarda solo el primario: los tonos derivados (hover, activo, texto
-- sobre el color) se calculan a partir de el, para que el taller elija UN color y
-- no tenga que entender una paleta.
ALTER TABLE configuracion ADD COLUMN color_primario VARCHAR(7) NULL
  COMMENT 'Color de marca del taller en hex (#rrggbb). NULL = por defecto';

-- El taller original conserva su carmesi; los nuevos arrancan sin color propio
-- hasta que lo definan.
UPDATE configuracion SET color_primario = '#e11d48' WHERE tenant_id = 1;
