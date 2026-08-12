import { Component, OnInit } from '@angular/core';
import * as QRCode from 'qrcode';
import { TallerService } from '../../services/taller.service';
import { MarcaService } from '../../services/marca.service';
import { ToastService } from '../../services/toast.service';

/**
 * Cómo llevar a los clientes al portal.
 *
 * El portal es la mitad del valor del producto —el cliente ve el avance de su vehículo
 * y deja de llamar cada veinte minutos— y hasta acá no había ningún camino que llevara
 * a usarlo: el taller tenía que armar la dirección a mano y adivinar qué escribirle a
 * la gente. Eso alcanzaba para que la función existiera y nadie la usara.
 *
 * Son tres formas porque son tres momentos distintos: el link para mandar por chat, el
 * QR para pegar en el mostrador, y el texto ya escrito para no tener que pensarlo.
 */
@Component({
  standalone: false,
  selector: 'app-admin-portal',
  templateUrl: './admin-portal.page.html',
  styleUrls: ['./admin-portal.page.scss'],
})
export class AdminPortalPage implements OnInit {
  enlace = '';
  qr: string | null = null;      // data URL del QR
  copiado: '' | 'enlace' | 'texto' = '';

  constructor(
    private taller: TallerService,
    private marca: MarcaService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.enlace = this.armarEnlace();
    this.generarQr();
  }

  get nombreTaller(): string { return this.marca.actual.nombre_taller || 'nuestro taller'; }

  /**
   * El link lleva el taller como parámetro y no como subdominio: hoy todos los talleres
   * viven en el mismo dominio, así que sin el parámetro el portal no sabría de quién es
   * (ver TallerService). Cuando cada taller tenga su subdominio, el parámetro sobra pero
   * no estorba — el subdominio manda.
   */
  private armarEnlace(): string {
    const slug = this.taller.actual();
    const base = `${window.location.origin}/portal`;
    return slug ? `${base}?taller=${encodeURIComponent(slug)}` : base;
  }

  private async generarQr(): Promise<void> {
    try {
      // Margen chico y buena corrección de errores: este QR termina impreso y pegado en
      // un mostrador, donde se raya y se moja.
      this.qr = await QRCode.toDataURL(this.enlace, {
        width: 480, margin: 2, errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' },
      });
    } catch {
      this.qr = null;   // sin QR la página sigue sirviendo: el link y el texto están
    }
  }

  /** El mensaje listo para pegar en WhatsApp. */
  get texto(): string {
    return `¡Hola! Desde ahora podés seguir el avance de tu vehículo en línea con ${this.nombreTaller}. `
      + `Entrá acá, registrate con tu correo y vas a ver en qué va, qué se le encontró y cuándo lo podés retirar:\n\n${this.enlace}`;
  }

  async copiar(que: 'enlace' | 'texto'): Promise<void> {
    const valor = que === 'enlace' ? this.enlace : this.texto;
    try {
      await navigator.clipboard.writeText(valor);
      this.copiado = que;
      setTimeout(() => { this.copiado = ''; }, 2000);
    } catch {
      // Sin permiso de portapapeles (o navegador viejo): se le dice, en vez de no hacer
      // nada y dejarlo creyendo que copió.
      this.toast.error('No se pudo copiar. Seleccioná el texto y copialo a mano.');
    }
  }

  abrirWhatsapp(): void {
    window.open(`https://wa.me/?text=${encodeURIComponent(this.texto)}`, '_blank', 'noopener');
  }

  /** Imprime solo el cartel del QR (ver la regla @media print de la hoja de estilos). */
  imprimir(): void { window.print(); }
}
