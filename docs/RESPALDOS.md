# Respaldos y restauración en PostgreSQL 18

El respaldo automático guarda **los datos de todos los talleres**, comprimidos en
SQL y opcionalmente cifrados. El esquema (tablas, índices, funciones y triggers)
se reconstruye con las migraciones del repositorio. No es un archivo de MySQL ni
un archivo custom de `pg_dump`.

**B-16 sigue pendiente del propietario:** tener este código no activa los
respaldos en producción. El propietario debe configurar el almacenamiento y
comprobar una primera copia. Esta tarea no configura variables de producción.

## Activación y operación

El job corre a las **08:30 UTC (02:30 en Costa Rica)**. Toma una fotografía de los
datos con una transacción `REPEATABLE READ READ ONLY`, comprime, cifra si hay
clave, sube a S3, verifica el tamaño y recién entonces rota las copias antiguas.
Usa la conexión privada del backend; no necesita exponer PostgreSQL a Internet.

El propietario configura estas variables en el servicio del backend, con los
valores del proveedor S3 elegido:

| Variable | Uso |
|---|---|
| `RESPALDO_S3_ENDPOINT` | URL del almacenamiento |
| `RESPALDO_S3_BUCKET` | Bucket destinado a respaldos |
| `RESPALDO_S3_ACCESS_KEY_ID` | Identificador de acceso |
| `RESPALDO_S3_SECRET_ACCESS_KEY` | Secreto de acceso |
| `RESPALDO_CLAVE` | Frase para cifrar con AES-256-GCM; guardarla también fuera del proveedor |

Las primeras cuatro son obligatorias. Sin `RESPALDO_CLAVE`, se suben archivos sin
cifrar. Opcionales: `RESPALDO_CONSERVAR` (14 por defecto), `RESPALDO_PREFIJO`
(`respaldos/`), `RESPALDO_S3_REGION` (`auto`) y `RESPALDO_S3_ESTILO` (`virtual` o
`path`, según el proveedor). No guardar secretos en git ni en comandos del historial.

Desde `backend/`, dentro del entorno del backend y con sus variables ya cargadas:

```sh
node scripts/respaldos.js ahora
node scripts/respaldos.js lista
```

`ahora` necesita acceso a la base; `lista` solo al almacenamiento. La primera
ejecución debe informar archivo, tamaño, tablas y filas. En el panel,
**Configuración → Respaldos** muestra las copias y el historial de
`respaldos_registro`; más de 30 horas sin copia produce estado atrasado.
Los fallos automáticos se notifican a los administradores activos de la plataforma
si el correo está configurado. Revisar también los logs: una copia subida no es
evidencia de restauración hasta completar el simulacro de abajo.

## Restaurar una copia automática

Usar una **base nueva y aislada de PostgreSQL 18**, sin backend ni jobs conectados,
y el rol dueño de esa base. Nunca cargar directamente sobre producción. No hace
falta superusuario si ese rol puede crear el esquema y la extensión `citext`.
Los comandos siguientes usan Bash y se ejecutan desde `backend/`, con Node 22,
`psql` 18 y gzip disponibles. En PowerShell se asignan variables con `$env:NOMBRE`;
para cargar SQL usar `psql -f`, evitando recodificarlo con `Get-Content | psql`.

### 1. Descargar, descifrar y comprobar el archivo

Con las variables S3 cargadas desde un gestor de secretos, elegir una clave real
de la salida de `lista`:

```sh
node scripts/respaldos.js bajar respaldos/BASE_FECHA.sql.gz.enc
```

Se guarda en `backend/backups/` (ignorado por git). Si está cifrado, `bajar` usa
`RESPALDO_CLAVE` y deja también el `.sql.gz` autenticado. Para un `.enc` ya descargado:

```sh
node scripts/respaldos.js abrir backups/BASE_FECHA.sql.gz.enc
```

La clave debe ser la utilizada al crear esa copia, aunque después se haya rotado.
Este formato tiene cabecera propia y etiqueta GCM: **no usar `openssl enc`**.
Una clave equivocada o un archivo alterado/cortado debe hacer fallar el comando;
no continuar con un archivo parcial. Para copias sin cifrar, omitir este paso.

```sh
gzip -t backups/BASE_FECHA.sql.gz
gzip -dc backups/BASE_FECHA.sql.gz > backups/restaurar.sql
head -n 6 backups/restaurar.sql
tail -n 2 backups/restaurar.sql
```

Cada comando debe terminar con código 0. Debe estar la última línea
`-- Respaldo completo: N tablas, M filas.` y la cabecera `-- Migraciones: [...]`.
La marca final detecta truncamientos, pero no sustituye la autenticación GCM.
Para copias antiguas sin historial ni cabecera de migraciones, identificar primero
el commit que produjo la copia; no adivinar el esquema ni cargarla sobre el actual.
El procedimiento comprobado aquí corresponde al formato que incluye ese historial.

### 2. Reconstruir exactamente el esquema del respaldo

Preparar un checkout del código usado al generar la copia, con el mismo conjunto
de migraciones que aparece en su cabecera, e instalar dependencias con `npm ci`.
Guardar junto a las copias el commit de cada despliegue permite recuperar ese código.
**No migrar primero a una versión posterior:** una migración puede transformar
datos que todavía no fueron cargados. El SQL rechaza un historial diferente.

Crear la base nueva con `createdb --template=template0` o con el administrador de
PostgreSQL. Configurar `DESTINO_URL` y `DATABASE_URL` solo en la terminal local de
restauración; ambos deben apuntar a esa base nueva. Usar un gestor de secretos o
`.pgpass` con permisos restringidos para las credenciales, sin escribirlas aquí.

```sh
# DESTINO_URL ya apunta a la nueva base de recuperación, nunca a producción.
export DATABASE_URL="$DESTINO_URL"
# Evitar heredar la URL del dueño de otra base desde un entorno de despliegue.
export MIGRACION_DATABASE_URL="$DESTINO_URL"
psql -X -v ON_ERROR_STOP=1 -d "$DESTINO_URL" -c 'SELECT current_database(), version();'
node src/db/migrar.js
```

`node src/db/migrar.js` ahora ejecuta realmente el migrador y cierra las conexiones.
Un fallo devuelve código distinto de cero. Revisar que la base mostrada sea la
nueva y que el listado de migraciones aplicadas coincida con la cabecera del SQL.
Hasta aquí solo debe existir el esquema y su tabla `schema_migraciones`, sin datos
de talleres. Si el esquema no coincide, preparar otra base con el checkout correcto.

### 3. Cargar con detención ante errores

```sh
psql -X -v ON_ERROR_STOP=1 -d "$DESTINO_URL" -f backups/restaurar.sql
```

Se requiere **salida 0**. `-X` ignora personalizaciones de `psqlrc`;
`ON_ERROR_STOP=1` detiene el cliente ante el primer error SQL (salida 3).
El archivo ya lleva `BEGIN` y `COMMIT`: no agregar otra transacción externa.
Se comprueban las versiones del esquema y que las tablas estén vacías, se bloquean
durante la carga, se insertan los datos y se verifican los conteos de cada tabla.
`schema_migraciones` recupera sus fechas originales sin duplicar registros.

Las FK de las migraciones son `DEFERRABLE`: se posponen para permitir referencias
circulares y se comprueban con `SET CONSTRAINTS ALL IMMEDIATE` antes de terminar.
**No desactivar triggers ni usar `session_replication_role = replica`**. Las
secuencias se ajustan después de verificar las FK, conservando tanto el máximo ID
como el contador consumido del origen (incluidas tablas vacías).

Ante un error, conservar la salida para diagnosticar y comenzar con otra base
nueva. Los datos se revierten al desconectar una transacción fallida, pero
`setval` no es transaccional: no reutilizar un destino fallido sin revisarlo.

### 4. Verificar antes de habilitar tráfico

Ejecutar la verificación incluida y guardar su salida con el acta del simulacro:

```sh
psql -X -v ON_ERROR_STOP=1 -d "$DESTINO_URL" -f scripts/verificar-restauracion.sql
node src/db/migrar.js
```

El verificador lista conteos de **todas** las tablas, conteos por `tenant_id`,
historial de migraciones y FK; falla si encuentra una FK sin validar, triggers FK
deshabilitados o una secuencia que colisionaría con IDs restaurados. No consume IDs.
Comparar los conteos con los comentarios `-- N filas en "tabla"` del respaldo;
el propio SQL ya los exige antes del `COMMIT`. El segundo comando debe decir
`Esquema al día`, sin ejecutar otra vez migraciones.

Comprobar en una instancia aislada de la aplicación los dos talleres, clientes,
vehículos y órdenes que se esperaban en esa fecha. Si se necesita actualizar a
código más reciente, hacerlo **después** de validar la restauración original:
ejecutar el migrador de esa versión y sus pruebas. El cambio de conexión y la
habilitación de producción corresponden al propietario, en una intervención aparte.

## Simulacro automatizado

`backend/test/pg-respaldo.test.js` crea dos bases temporales propias a partir del
prefijo de `PG_TEST_URL`, ambas terminadas en `_test`. Requiere PostgreSQL local,
un usuario con `CREATEDB`. No conecta a la base configurada en un `.env` de
producción. Al terminar elimina solo las bases que creó esa ejecución.

```sh
# Desde backend/, con una URL local de prueba suministrada por el entorno:
PG_TEST_URL="$URL_PRUEBA_LOCAL" npm test
```

En Windows sin cliente local, especificar el contenedor que aloja **ese mismo
servidor**; se usa su `psql` por stdin, sin montar ni publicar datos:

```powershell
$env:PG_TEST_URL = 'postgres://motiq:motiq_dev@localhost:5433/motiq_t01_test'
$env:PSQL_DOCKER_CONTAINER = 'motiq-pg18'
npm test
```

También se admite `PSQL_BIN` con la ruta del ejecutable local. Si no hay `psql`
en el `PATH` ni se indica uno, la prueba carga el mismo SQL con el driver `pg` en
una sola consulta (un error revierte todo, como `ON_ERROR_STOP`) y lo informa en
la línea `Carga del SQL con: driver`. Para el acta de un simulacro manual, usar
siempre `psql`. Sin `PG_TEST_URL` se omiten las pruebas de integración; eso no
constituye un simulacro aprobado.

La prueba pasa por el servicio real de respaldo, con almacenamiento local de
prueba en lugar de S3, comprime, cifra, descifra y carga mediante
`psql -X -v ON_ERROR_STOP=1`. Compara todas las filas y conteos, también por taller,
incluido el historial de migraciones, JSON, texto con emoji/comillas, decimales y
columnas generadas. Corre `scripts/verificar-restauracion.sql` sobre la base
restaurada. Verifica secuencias, idempotencia del migrador y rechazo sin
datos parciales de una FK rota, un esquema distinto o un destino con datos.
Las pruebas de S3 y cifrado complementarias están en `test/respaldo.test.js`.

## Respaldo manual y límites

- `scripts/backup-db.js` usa **`pg_dump -Fc`**, no `mysqldump`. Su `.dump` incluye
  esquema y datos; restaurarlo en otra base vacía con
  `pg_restore --exit-on-error --single-transaction --no-owner --no-acl -d "$DESTINO_URL" archivo.dump`.
  No ejecutar el migrador antes de cargar ese formato. Usar herramientas PostgreSQL 18.
- El respaldo automático incluye las tablas del esquema de la aplicación y el
  historial, pero no guarda DDL, roles de PostgreSQL, permisos del servidor, archivos
  externos ni objetos de R2. Las funciones y triggers se recuperan de las migraciones.
- El formato supone el esquema `public`, FK diferibles y secuencias ascendentes
  asociadas a columnas identity/serial. Si cambian estas condiciones, extender el
  simulacro antes de aceptar la migración. El respaldo rechaza secuencias descendentes.
- Las secuencias no tienen snapshot transaccional: pueden quedar adelantadas si
  había escrituras concurrentes. Eso evita reutilizar IDs; no representa filas perdidas.
- No ejecutar migraciones DDL mientras se toma la copia. La consistencia garantizada
  por `REPEATABLE READ` corresponde a los datos, no a un despliegue concurrente.
- Con una copia diaria puede perderse hasta lo trabajado desde la última copia
  válida. El tiempo de recuperación depende del tamaño y debe medirse en simulacros.
- Una copia en el mismo proveedor no cubre perder la cuenta entera. El propietario
  debe conservar también copias y claves independientes. Borrar los archivos locales
  con datos de clientes al terminar; no compartirlos ni sincronizarlos públicamente.

Referencias: [restauración SQL en PostgreSQL 18](https://www.postgresql.org/docs/18/backup-dump.html),
[restricciones diferibles](https://www.postgresql.org/docs/18/sql-set-constraints.html) y
[secuencias y transacciones](https://www.postgresql.org/docs/18/functions-sequence.html).
