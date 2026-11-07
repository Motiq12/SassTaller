export interface Usuario {
  id?: number;
  nombre: string;
  email: string;
  telefono?: string;
  rol: 'recepcion' | 'tecnico' | 'admin' | 'contenido';
  // Rol propio (Equipo → Roles) y su nombre; null = el de fábrica de `rol`.
  rol_id?: number | null;
  rol_nombre?: string | null;
  // Las casillas de su rol y cuáles de ellas se eligen en su base (las demás no se
  // revisan). Solo sirven para esconder botones: la API las vuelve a revisar.
  permisos?: string[];
  permisos_ajustables?: string[];
  // Apartados del sitio web que puede administrar (el admin puede todo sin marcar
  // nada). Solo sirve para armar el menú: la API los vuelve a revisar siempre.
  permisos_web?: Record<string, boolean>;
  sucursal_id?: number | null;       // local del empleado (null = atiende ambas)
  sucursal_nombre?: string | null;
  foto?: string | null;
  // Gustos propios de Mi perfil (pantalla de inicio, sede, avisos apagados).
  preferencias?: PreferenciasPersonal;
  activo?: number;
  created_at?: string;
}

export interface PreferenciasPersonal {
  inicio: string | null;
  sede_id: number | null;
  avisos_off: string[];
}

export interface LoginResponse {
  token: string;
  usuario: Usuario;
}
