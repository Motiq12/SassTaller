require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

async function run() {
  const config = process.env.MYSQL_URL
    ? { uri: process.env.MYSQL_URL, multipleStatements: true }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'proyecto_taller',
        multipleStatements: true,
      };

  const conn = await mysql.createConnection(config);
  console.log('✅ Conectado a MySQL');

  const sql = fs.readFileSync(path.join(__dirname, '../../schema.sql'), 'utf8');
  await conn.query(sql);
  console.log('✅ Schema ejecutado');

  // Cuentas semilla: la contraseña se toma de variables de entorno; sin ellas no se
  // crean (evita dejar credenciales conocidas en producción). Para sembrarlas, definí
  // SEED_ADMIN_PASSWORD / SEED_RECEP_PASSWORD (y opcionalmente *_EMAIL) antes de migrar.
  await seedUsuario(conn, {
    nombre: 'Administrador', rol: 'admin',
    email: process.env.SEED_ADMIN_EMAIL || 'admin@taller.com',
    password: process.env.SEED_ADMIN_PASSWORD,
  });
  await seedUsuario(conn, {
    nombre: 'Recepción', rol: 'recepcion',
    email: process.env.SEED_RECEP_EMAIL || 'recepcion@taller.com',
    password: process.env.SEED_RECEP_PASSWORD,
  });

  await conn.end();
  console.log('🎉 Migración completa');
}

// Crea una cuenta semilla solo si su contraseña viene por entorno (≥8 chars).
// Nunca imprime la contraseña. Idempotente (INSERT IGNORE por email único).
async function seedUsuario(conn, { nombre, email, rol, password }) {
  if (!password) {
    console.warn(`⚠️  Seed de ${rol} (${email}) omitido: definí su contraseña en una variable de entorno.`);
    return;
  }
  if (String(password).length < 8) {
    console.warn(`⚠️  Seed de ${rol} omitido: la contraseña debe tener al menos 8 caracteres.`);
    return;
  }
  const hash = await bcrypt.hash(String(password), 10);
  await conn.query(
    'INSERT IGNORE INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)',
    [nombre, email, hash, rol]
  );
  console.log(`✅ Usuario ${rol} listo (${email})`);
}

run().catch(err => {
  console.error('❌ Error en migración:', err.message);
  process.exit(1);
});
