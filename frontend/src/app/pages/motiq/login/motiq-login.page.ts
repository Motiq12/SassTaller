import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MotiqService } from '../../../services/motiq.service';
import { MarcaService } from '../../../services/marca.service';
import { PRODUCTO } from '../../../shared/producto';

/**
 * Entrada al panel de la plataforma. Es una pantalla del PRODUCTO: acá no hay ningún
 * taller de por medio, así que se muestra la marca de Motiq y no la de nadie más.
 */
@Component({
  selector: 'app-motiq-login',
  templateUrl: './motiq-login.page.html',
  styleUrls: ['./motiq-login.page.scss'],
  standalone: false,
})
export class MotiqLoginPage implements OnInit {
  producto = PRODUCTO;
  email = '';
  password = '';
  cargando = false;
  error = '';

  constructor(private motiq: MotiqService, private marca: MarcaService, private router: Router) {}

  ngOnInit() {
    // Si quedó pintado el color de un taller (de una sesión abierta en otra pestaña),
    // se vuelve al del producto: este panel no pertenece a ningún taller.
    this.marca.limpiar();
  }

  entrar() {
    if (!this.email.trim() || !this.password || this.cargando) return;
    this.cargando = true;
    this.error = '';
    this.motiq.login(this.email.trim(), this.password).subscribe({
      next: () => this.router.navigate(['/motiq/panel'], { replaceUrl: true }),
      error: (e) => {
        this.cargando = false;
        // Sin distinguir "no existe" de "clave incorrecta": esta cuenta abre los datos
        // de todos los talleres, y decir cuál de los dos falló confirmaría correos.
        this.error = e?.status === 401
          ? 'Correo o contraseña incorrectos'
          : (e?.error?.error || 'No se pudo conectar con el servidor');
      },
    });
  }
}
