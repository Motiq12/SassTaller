// Helpers de mensajería interna (v3): lectura POR USUARIO.
// La tabla `mensaje_lecturas (mensaje_id, usuario_id)` guarda quién ya leyó cada
// mensaje. Un mensaje está "no leído" para U si U es destinatario, no es el remitente
// y no existe su fila de lectura. Así el badge de no-leídos es confiable por persona
// (antes `leido` era global: al abrir la bandeja se apagaba para todo el rol).
// Subconsulta para saber si YO (usuario_id = ?) ya leí el mensaje `m`.
// Devuelve el fragmento SELECT; el llamador agrega el parámetro (id del usuario).
// Lleva el filtro por taller aunque el mensaje ya venga acotado: la subconsulta es
// una entrada propia a mensaje_lecturas y el guard exige que cada tabla se filtre.
// ::int — en MySQL EXISTS daba 1/0 y el frontend lo trata así; en Postgres es boolean.
const LEIDO_POR_MI = `EXISTS(SELECT 1 FROM mensaje_lecturas ml WHERE ml.mensaje_id = m.id AND ml.usuario_id = ? AND ml.tenant_id = @tenant)::int AS leido`;

// ¿Alguien distinto del remitente ya lo leyó? Sirve para el acuse "visto" (✓✓) que
// ve el que envió. No lleva parámetro.
const VISTO_POR_OTRO = `EXISTS(SELECT 1 FROM mensaje_lecturas ml2 WHERE ml2.mensaje_id = m.id AND ml2.usuario_id <> m.remitente_id AND ml2.tenant_id = @tenant)::int AS visto`;

// Marca como leídos (por-usuario) los mensajes recibidos que aparecen en `rows`.
// No marca los propios (remitente = yo). Idempotente: si ya estaba leído, la PK
// (mensaje_id, usuario_id) choca y ON CONFLICT lo ignora.
async function marcarLeidos(db, usuarioId, rows) {
  const ids = (rows || []).filter((m) => m.remitente_id !== usuarioId && !m.leido).map((m) => m.id);
  if (!ids.length) return;
  // Una tupla por mensaje. Antes era `VALUES ?` con un arreglo de arreglos, que es una
  // extensión de mysql2; ahora los placeholders se arman explícitos.
  const tuplas = ids.map(() => '(@tenant, ?, ?)').join(', ');
  await db.query(
    `INSERT INTO mensaje_lecturas (tenant_id, mensaje_id, usuario_id) VALUES ${tuplas} ON CONFLICT DO NOTHING`,
    ids.flatMap((id) => [id, usuarioId])
  );
}

module.exports = { LEIDO_POR_MI, VISTO_POR_OTRO, marcarLeidos };
