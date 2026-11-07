# Respaldos de la base

El sistema respalda su base de datos solo, todas las noches. Este documento dice
cómo encenderlo, cómo ver que esté funcionando y cómo recuperar la base el día que
haga falta.

## Qué hace

Todos los días a las **08:30 UTC (2:30 am en Costa Rica)** el backend:

1. Vuelca la base entera a SQL, en una sola transacción (una foto coherente,
   aunque alguien esté usando el sistema en ese momento).
2. La comprime y, si hay frase configurada, la cifra.
3. La sube a un almacenamiento compatible con S3 y comprueba que quedó guardada
   con el tamaño correcto.
4. Borra los respaldos más viejos y deja los últimos 14 (configurable).

Usa la misma conexión privada que la app: **no necesita que la base tenga una
puerta pública**. Si algo falla, queda en el registro y le llega un correo al taller
(al correo cargado en Configuración).

Al arrancar, el servidor dice en el registro cómo está:

```
💾 Respaldo automático: todos los días a las 08:30 UTC (02:30 en CR), se conservan 14, cifrados
💾 Respaldo automático SIN CONFIGURAR (faltan …): la base no se está respaldando sola
```

## Encenderlo (una sola vez)

Hace falta un lugar donde guardar los archivos. Lo más simple es un **bucket de
Railway**, en el mismo proyecto.

1. En Railway, proyecto `just-renewal`: **Create → Bucket**. Un nombre como
   `respaldos`.
2. En el servicio **Proyecto-taller → Variables**, agregar estas cuatro. Al
   escribir `${{` Railway ofrece el bucket y sus valores, así no hay que copiar
   ningún secreto a mano:

   | Variable | Valor |
   |---|---|
   | `RESPALDO_S3_ENDPOINT` | `${{respaldos.ENDPOINT}}` |
   | `RESPALDO_S3_BUCKET` | `${{respaldos.BUCKET}}` |
   | `RESPALDO_S3_ACCESS_KEY_ID` | `${{respaldos.ACCESS_KEY_ID}}` |
   | `RESPALDO_S3_SECRET_ACCESS_KEY` | `${{respaldos.SECRET_ACCESS_KEY}}` |

   (`respaldos` es el nombre que se le haya puesto al bucket.)
3. Agregar `RESPALDO_CLAVE` con una frase larga. Con ella los respaldos salen
   cifrados del servidor. **Guardala también fuera de Railway** (un gestor de
   contraseñas): sin esa frase los respaldos no se pueden abrir, y si Railway se
   pierde, se pierde con él.
4. Railway redespliega. En el registro tiene que aparecer la línea
   `💾 Respaldo automático: …`.
5. Probarlo sin esperar a la noche:

   ```
   railway ssh --service Proyecto-taller node backend/scripts/respaldos.js ahora
   ```

   Tiene que contestar `✅ Respaldo subido: …` con el tamaño y la cantidad de tablas.

Opcionales: `RESPALDO_CONSERVAR` (cuántos se guardan, por defecto 14),
`RESPALDO_PREFIJO` (carpeta dentro del bucket), `RESPALDO_S3_REGION` (por defecto
`auto`) y `RESPALDO_S3_ESTILO` (`virtual` por defecto; `path` para un proveedor que
lo pida). Con otro proveedor (Cloudflare R2, Backblaze B2) son las mismas cuatro
variables con sus datos.

## Ver qué respaldos hay

Lo más fácil: en el panel, **Configuración → Respaldos**. Ahí se ve si está al
día, atrasado (más de 30 horas sin uno bueno) o si el último falló, con las copias
guardadas, el historial y un botón para respaldar en el momento (uno cada 10
minutos). Cada respaldo queda anotado en la tabla `respaldos_registro`.

Desde la computadora, en la carpeta del proyecto:

```
railway run --service Proyecto-taller node backend/scripts/respaldos.js lista
```

Conviene mirarlo de vez en cuando: tiene que haber uno por día y el tamaño tiene
que ir creciendo de a poco, no caer de golpe.

## Recuperar la base

1. Bajar el respaldo (queda en `backend/backups/`, que git ignora; si está cifrado,
   lo descifra con la `RESPALDO_CLAVE`):

   ```
   railway run --service Proyecto-taller node backend/scripts/respaldos.js bajar respaldos/railway_2026-10-08T08-30-00Z.sql.gz.enc
   ```

2. Cargarlo en la base de destino con el cliente de MySQL:

   ```
   gunzip -c backend/backups/railway_2026-10-08T08-30-00Z.sql.gz | mysql --default-character-set=utf8mb4 -h <host> -P <puerto> -u <usuario> -p <base>
   ```

   **Ojo:** el archivo borra y vuelve a crear cada tabla. Cargarlo en la base de
   producción la deja como estaba a la hora del respaldo: todo lo que se haya
   trabajado después se pierde. Lo prudente es restaurarlo primero en una base
   aparte, mirar que esté lo que se busca, y recién entonces decidir.

3. La última línea del archivo dice `-- Respaldo completo: N tablas, M filas.`
   Si no está, el archivo quedó cortado: usar otro.

El archivo bajado tiene los datos de todos los clientes. No compartirlo ni dejarlo
en una carpeta sincronizada; borrarlo al terminar.

## Límites, para tenerlos presentes

- **El bucket está en el mismo proveedor que la base.** Protege de un borrado o de
  una base dañada, no de perder la cuenta de Railway. Cada tanto conviene bajar
  uno y guardarlo en otro lado.
- Respalda tablas y datos. No hay vistas, disparadores ni procedimientos en la
  base; si algún día se agregan, hay que sumarlos al volcado
  (`backend/src/utils/volcado.js`).
- Si un despliegue coincide justo con las 2:30 am, el respaldo de esa noche puede
  no correr. El siguiente corre normal.
- El respaldo manual (`backend/scripts/backup-db.js`) sigue existiendo, pero usa
  `mysqldump` desde la computadora y necesita la puerta pública de la base.

## Cómo se comprobó

Además de las pruebas automáticas (`backend/test/respaldo.test.js`), se probó
contra un MySQL real: se respaldó una base con datos difíciles (emoji, comillas,
JSON, binarios, nulos, números enormes, fechas, una columna generada), se bajó, se
descifró y se restauró en otra base con el cliente `mysql`. Las 35 tablas quedaron
idénticas en estructura, cantidad de filas y suma de control. Con 250 MB de fotos,
el respaldo tardó 10 segundos y usó 83 MB de memoria.
