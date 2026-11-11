// Lo que cualquier miembro del personal hace con SU PROPIA cuenta: cambiar la foto
// y cambiar la contraseña.
//
// No es un router que se monte en `/api/algo`: es un tramo que los paneles por rol
// montan dentro del suyo (`router.use(perfilPropio)`), así que las rutas quedan en
// `/api/recepcion/perfil/...` y `/api/mecanico/perfil/...` como siempre.
//
// Vive aparte porque estaba copiado letra por letra en los dos paneles: las mismas
// 16 líneas, el mismo bcrypt, el mismo mínimo de 8 caracteres, y la única diferencia
// era el orden de dos cláusulas WHERE. Con la política de contraseñas en dos lugares,
// endurecerla en uno y olvidar el otro no es una posibilidad remota: es lo que pasa.
//
// Quien lo monta ya resolvió el acceso (`auth` + piso de rol), así que acá se da por
// hecho que hay `req.usuario` y un `req.db` acotado al taller. Todo opera sobre
// `req.usuario.id` y nunca sobre un id que venga del cliente: nadie puede cambiarle
// la foto ni la contraseña a otro por esta vía.
const router = require('express').Router();
const bcrypt = require('bcrypt');
const { fail } = require('../utils/responder');
const { fotoValida } = require('../utils/validar');
const { getConfig } = require('../utils/configuracion');
const { politica, problemaDeContrasena } = require('../utils/contrasena');

router.put('/perfil/foto', async (req, res) => {
  try {
    const { foto } = req.body;
    if (!fotoValida(foto)) return res.status(400).json({ error: 'Imagen inválida' });
    await req.db.query(
      'UPDATE usuarios SET foto = ? WHERE id = ? AND tenant_id = @tenant',
      [foto || null, req.usuario.id]
    );
    res.json({ data: { foto: foto || null }, message: foto ? 'Foto actualizada' : 'Foto eliminada' });
  } catch (err) {
    fail(res, err);
  }
});

router.put('/perfil/password', async (req, res) => {
  try {
    const { actual, nueva } = req.body;
    if (!actual || !nueva) return res.status(400).json({ error: 'Contraseña actual y nueva son requeridas' });
    const [[u]] = await req.db.query(
      'SELECT password_hash, email, nombre FROM usuarios WHERE id = ? AND tenant_id = @tenant',
      [req.usuario.id]
    );
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
    // La política de Configuración → Seguridad. Este tramo responde antes que la ruta
    // propia del panel del mecánico, y sin esto se la saltaba: aceptaba «12345678».
    const malaClave = problemaDeContrasena(nueva, politica(await getConfig(req.db)), u);
    if (malaClave) return res.status(400).json({ error: malaClave, campo: 'nueva' });
    // Se exige la contraseña actual: sin esto, una sesión robada o un equipo que
    // quedó abierto alcanzan para quedarse con la cuenta.
    const ok = await bcrypt.compare(String(actual), u.password_hash);
    if (!ok) return res.status(400).json({ error: 'La contraseña actual no es correcta' });
    const hash = await bcrypt.hash(String(nueva), 10);
    await req.db.query(
      'UPDATE usuarios SET password_hash = ? WHERE id = ? AND tenant_id = @tenant',
      [hash, req.usuario.id]
    );
    res.json({ message: 'Contraseña actualizada' });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
