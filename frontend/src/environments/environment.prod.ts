export const environment = {
  production: true,
  // Web: la API se sirve desde el mismo origen que el frontend, así que basta la ruta.
  apiUrl: '/api',
  // App nativa: acá SÍ hace falta el dominio completo, porque la app no se sirve
  // desde ningún servidor — corre en el teléfono y no tiene un origen al que volver.
  //
  // El valor es un placeholder a propósito. Antes apuntaba al servidor de producción
  // del proyecto que clonamos (proyecto-taller-production-*.up.railway.app): un build
  // nativo de este SaaS habría conectado a la base real de ESE taller, mostrando sus
  // clientes y permitiendo escribir en el sistema que usan para trabajar.
  //
  // `.invalid` es un dominio reservado que jamás resuelve (RFC 2606), así que si
  // alguien compila sin cambiarlo la app falla de entrada en vez de conectarse por
  // error a un servidor ajeno. Reemplazalo por tu dominio cuando tengas hosting.
  nativeApiUrl: 'https://configura-tu-dominio.invalid',
  // Site key de Cloudflare Turnstile (captcha anti-bot). Vacío = desactivado.
  // Pegá acá el site key de tu cuenta de Cloudflare para activarlo en la web.
  turnstileSiteKey: ''
};
