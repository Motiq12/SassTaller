// El volcado del repo no lleva contraseñas que funcionen.
//
// Llevaba los hashes de `Admin2024!` y `Recep2024!` —que además están escritos en el
// README—, así que cualquiera que clonara el repo tenía servida una cuenta admin. Y un
// hash commiteado no se borra: queda en el historial de git para siempre.
//
// Ahora `db:exportar` reemplaza cada hash por el centinela de abajo y `db:importar`
// genera contraseñas nuevas al terminar y las imprime una sola vez.
//
// El centinela NO es un hash de bcrypt válido, y esa es la propiedad que importa: si
// alguien importa el volcado sin pasar por el import (cargando el .sql a mano, por
// ejemplo), `bcrypt.compare` devuelve false contra cualquier contraseña. Falla cerrado.
const SIN_PASSWORD = '!sin-password!';

module.exports = { SIN_PASSWORD };
