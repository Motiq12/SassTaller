# Configuración de Railway como código

La configuración del servicio `SassTaller` (cómo se construye, cómo arranca, el chequeo de salud, la política
de reinicio, los dominios y la región) vive en `.railway/railway.ts`. Reemplaza a `railway.json`, que Railway
dejó de leer el 2026-12-01.

**Railway no lee este archivo al desplegar.** Un cambio en `.railway/railway.ts` no hace nada hasta que
alguien lo aplica a mano. Primero se mergea el PR y después se aplica.

Las variables (`DATABASE_URL`, `JWT_SECRET`, `RESEND_API_KEY`, `TOTP_CLAVE`…) **no** están acá: siguen en el
panel de Railway (`variables: { managed: false }`). Nunca pongas un secreto en este archivo.

## Cambiar la configuración

Desde la raíz del repo, con el CLI de Railway logueado y la carpeta vinculada al proyecto
(`railway link --project 84437c29-85cd-4c5e-b12d-4f0e157a8e04 --service SassTaller --environment production`):

```bash
npm install                 # instala el SDK `railway` (solo hace falta para plan/apply)
railway config plan         # muestra qué cambiaría en producción, sin tocar nada
railway config apply        # lo aplica (cambia producción: revisá el plan antes)
```

Si el plan muestra algo que no esperabas, sobre todo `to destroy`, no lo apliques.

## En Windows

El SDK verifica la versión del CLI ejecutando `railway --version`. En Windows falla con el error *"requires
Railway CLI 5.42.1 or newer"* aunque el CLI esté al día, porque Node no puede ejecutar el `railway.cmd` de npm.
Hay que indicarle el ejecutable real, desde PowerShell:

```powershell
$env:_ = "$env:APPDATA\npm\node_modules\@railway\cli\bin\railway.exe"
& $env:_ config plan
```

Desde Git Bash no funciona: Bash pisa la variable `_` con una ruta estilo Unix.
