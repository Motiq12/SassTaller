# Entrar con Google (portal del cliente)

El portal ofrece **"Continuar con Google"** en Entrar y en Crear cuenta. Mientras no se
configure, el botón no aparece y todo sigue como antes.

## Cómo funciona

1. El botón es el oficial de Google (Google Identity Services). Al tocarlo, Google
   devuelve un token firmado con el correo de la persona.
2. El servidor lo comprueba (`backend/src/utils/google-id.js`): la firma, que sea para
   esta aplicación, que no haya vencido y que Google haya verificado el correo.
3. Después:
   - **Ya tenía cuenta**, por su cuenta de Google o por el mismo correo: entra directo.
     La primera vez queda unida a su cuenta de Google (`clientes.google_sub`) y el
     correo pasa a verificado.
   - **No tenía cuenta**: va a "Termina tu cuenta". Ahí se completan nombre y
     apellido, que vienen de Google, y se agregan teléfono y cédula. La cuenta se crea
     sin contraseña. Si después quiere una, la crea en "¿Olvidaste tu contraseña?".
4. Si un correo ya está unido a **otra** cuenta de Google, no se toca: tiene que
   entrar con su correo y su contraseña.

Solo clientes. El personal del taller sigue entrando con correo, contraseña y, si la
tiene activada, la verificación en dos pasos.

**En la app de Android el botón no sale:** el botón web no funciona dentro de la app.
Para tenerlo ahí hace falta un plugin nativo, que va en otro cambio.

## Cómo activarlo

En [Google Cloud Console](https://console.cloud.google.com/), con la cuenta del
negocio:

1. Crear un proyecto, por ejemplo **MS Motos**, o usar uno que ya exista.
2. **APIs y servicios → Pantalla de consentimiento de OAuth:**
   - tipo **Externo**;
   - nombre de la app **MS Motos**, el correo de soporte y el logo;
   - permisos (scopes): solo `email`, `profile` y `openid`;
   - publicar la app (pasar a "En producción"). Con esos tres permisos Google no pide
     revisión.
3. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth:**
   - tipo **Aplicación web**;
   - en **Orígenes de JavaScript autorizados**, cada dirección desde donde se abre el
     portal:
     - `https://proyecto-taller-production-0e4b.up.railway.app`
     - `https://taller.msmotos.com`, cuando el dominio esté listo
     - `http://localhost:8100` y `http://127.0.0.1:3900`, para probar en local
   - las URI de redirección se dejan vacías: el botón usa una ventana emergente.
4. Copiar el **ID de cliente**, que termina en `.apps.googleusercontent.com`, y
   ponerlo en Railway, en el servicio **sistema** → Variables → `GOOGLE_CLIENT_ID`.
   No es secreto: va también al navegador.
5. Railway redespliega solo. Al abrir Entrar debería aparecer el botón.

Para apagarlo, borrar la variable.
