import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import * as QRCode from 'qrcode';
import { MotiqService, ClaveDosPasos } from '../../../services/motiq.service';
import { MarcaService } from '../../../services/marca.service';
import { PRODUCTO } from '../../../shared/producto';

/**
 * Entrada al panel de la plataforma. Es una pantalla del PRODUCTO: acá no hay ningún
 * taller de por medio, así que se muestra la marca de Motiq y no la de nadie más.
 *
 * B-06: esta cuenta ve todos los talleres, así que el segundo factor es obligatorio.
 *   clave      → correo y contraseña (nunca abre sesión sola)
 *   codigo     → código de la app de autenticación, o uno de respaldo
 *   configurar → primer ingreso: QR de la app y primer código para activarla
 *   respaldo   → los códigos de respaldo, que se muestran esta única vez
 */
type Paso = 'clave' | 'codigo' | 'configurar' | 'respaldo';

@Component({
  selector: 'app-motiq-login',
  templateUrl: './motiq-login.page.html',
  styleUrls: ['./motiq-login.page.scss'],
  standalone: false,
})
export class MotiqLoginPage implements OnInit {
  private motiq = inject(MotiqService);
  private marca = inject(MarcaService);
  private router = inject(Router);

  producto = PRODUCTO;
  paso: Paso = 'clave';
  email = '';
  password = '';
  codigo = '';
  cargando = false;
  error = '';

  private tokenParcial = '';
  clave: ClaveDosPasos | null = null;
  qr: string | null = null;            // data URL del QR de la app
  respaldos: string[] = [];
  respaldosGuardados = false;
  copiado = false;

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
      next: ({ data }) => {
        this.tokenParcial = data.token_parcial;
        this.password = '';
        this.codigo = '';
        if (data.requiere_configurar_2fa) {
          this.prepararConfiguracion();
        } else {
          this.cargando = false;
          this.paso = 'codigo';
        }
      },
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

  // Primer ingreso: pide la clave nueva y dibuja el QR.
  private prepararConfiguracion() {
    this.motiq.configurarDosPasos(this.tokenParcial).subscribe({
      next: async ({ data }) => {
        this.clave = data;
        try {
          this.qr = await QRCode.toDataURL(data.uri, { margin: 1, width: 220, errorCorrectionLevel: 'M' });
        } catch {
          this.qr = null;   // sin QR sigue sirviendo: se puede tipear la clave
        }
        this.cargando = false;
        this.paso = 'configurar';
      },
      error: (e) => this.fallaDelPaso(e),
    });
  }

  // El código de 6 dígitos (o uno de respaldo, "A1B2-C3D4").
  confirmarCodigo() {
    const codigo = this.codigo.trim();
    if (!codigo || this.cargando) return;
    this.cargando = true;
    this.error = '';
    if (this.paso === 'configurar') {
      this.motiq.activarDosPasos(this.tokenParcial, codigo).subscribe({
        next: ({ data }) => {
          this.cargando = false;
          this.tokenParcial = '';
          this.respaldos = data.codigos_respaldo || [];
          this.paso = 'respaldo';
        },
        error: (e) => this.fallaDelPaso(e),
      });
    } else {
      this.motiq.verificarDosPasos(this.tokenParcial, codigo).subscribe({
        next: () => this.alPanel(),
        error: (e) => this.fallaDelPaso(e),
      });
    }
  }

  private fallaDelPaso(e: any) {
    this.cargando = false;
    this.codigo = '';
    const mensaje: string = e?.error?.error || 'No se pudo conectar con el servidor';
    // El token parcial dura 5 minutos y la contraseña pudo cambiar en el medio: hay
    // que volver a empezar desde la contraseña.
    if (e?.status === 401 && /venci/i.test(mensaje)) {
      this.volver();
      this.error = mensaje;
      return;
    }
    this.error = mensaje;
  }

  async copiarRespaldos() {
    try {
      await navigator.clipboard.writeText(this.respaldos.join('\n'));
      this.copiado = true;
    } catch {
      this.copiado = false;
    }
  }

  alPanel() {
    this.router.navigate(['/motiq/panel'], { replaceUrl: true });
  }

  volver() {
    this.paso = 'clave';
    this.tokenParcial = '';
    this.codigo = '';
    this.clave = null;
    this.qr = null;
    this.error = '';
    this.cargando = false;
  }
}
