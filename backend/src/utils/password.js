// Contraseña inicial generada, para cuentas que crea otro (un admin de Motiq dando de
// alta a un taller, o el script de administradores de plataforma).
//
// Se genera y se muestra UNA vez en vez de pedirla: la que se escribe en una terminal
// queda en el historial del shell, y la que elige un tercero por teléfono termina
// siendo "Taller2026".
const crypto = require('crypto');

// Sin caracteres que rompan un .env o una URL si después se copia a algún lado, y sin
// los pares que se confunden al dictarla (O/0, l/1/I).
const MAYUS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MINUS = 'abcdefghijkmnopqrstuvwxyz';
const DIGITOS = '23456789';
const SIGNOS = '!@%&*_-+=?';

function generarPassword(n = 20) {
  const todo = MAYUS + MINUS + DIGITOS + SIGNOS;
  // Uno de cada clase primero, para que siempre cumpla cualquier regla de composición.
  const salida = [MAYUS, MINUS, DIGITOS, SIGNOS].map(s => s[crypto.randomInt(s.length)]);
  while (salida.length < n) salida.push(todo[crypto.randomInt(todo.length)]);
  // Fisher-Yates con aleatoriedad criptográfica: sin esto los cuatro primeros caracteres
  // tendrían siempre el mismo tipo y en el mismo orden.
  for (let i = salida.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [salida[i], salida[j]] = [salida[j], salida[i]];
  }
  return salida.join('');
}

module.exports = { generarPassword };
