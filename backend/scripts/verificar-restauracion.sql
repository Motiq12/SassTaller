-- Solo lectura. Ejecutar con psql -X -v ON_ERROR_STOP=1 -d <destino> -f <este archivo>.
SET search_path = public;
BEGIN READ ONLY;
SELECT current_database() AS base, version();
SELECT nombre, aplicada_en FROM schema_migraciones ORDER BY nombre;

-- Conteos exactos, incluso tablas vacías y tablas sin tenant_id.
SELECT format('SELECT %L AS tabla, count(*) AS filas FROM %I.%I;',
              table_name, table_schema, table_name)
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name
\gexec

SELECT format('SELECT %L AS tabla, tenant_id, count(*) AS filas FROM %I.%I GROUP BY tenant_id ORDER BY tenant_id;',
              table_name, table_schema, table_name)
FROM information_schema.columns
WHERE table_schema = 'public' AND column_name = 'tenant_id'
ORDER BY table_name
\gexec

SELECT conrelid::regclass AS tabla, conname, convalidated, condeferrable
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace AND contype = 'f'
ORDER BY 1, 2;

DO $verificar$
DECLARE
  col record;
  valor bigint;
  llamada boolean;
  maximo bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = 'public'::regnamespace
             AND contype = 'f' AND (NOT convalidated OR NOT condeferrable)) THEN
    RAISE EXCEPTION 'Hay FK sin validar o no diferibles; revisar el esquema';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_constraint c ON c.oid = t.tgconstraint
             WHERE c.connamespace = 'public'::regnamespace AND c.contype = 'f'
               AND t.tgenabled NOT IN ('O', 'A')) THEN
    RAISE EXCEPTION 'Hay triggers de FK deshabilitados';
  END IF;
  FOR col IN
    SELECT table_name, column_name,
           pg_get_serial_sequence(format('%I.%I', table_schema, table_name), column_name) AS secuencia
    FROM information_schema.columns WHERE table_schema = 'public'
  LOOP
    IF col.secuencia IS NULL THEN CONTINUE; END IF;
    EXECUTE format('SELECT last_value, is_called FROM %s', col.secuencia) INTO valor, llamada;
    EXECUTE format('SELECT max(%I) FROM public.%I', col.column_name, col.table_name) INTO maximo;
    IF maximo IS NOT NULL AND (valor < maximo OR (valor = maximo AND NOT llamada)) THEN
      RAISE EXCEPTION 'Secuencia desfasada: %, valor %, máximo %', col.secuencia, valor, maximo;
    END IF;
    RAISE NOTICE 'Secuencia OK: %, valor %, llamada %, máximo %', col.secuencia, valor, llamada, maximo;
  END LOOP;
END $verificar$;
COMMIT;
