import { Component, inject } from '@angular/core';
import { AuthService } from '../../services/auth.service';

@Component({
  standalone: false,
  selector: 'app-tabs',
  templateUrl: './tabs.page.html',
  styleUrls: ['./tabs.page.scss'],
})
export class TabsPage {
  private auth = inject(AuthService);

  get esAdmin(): boolean {
    return this.auth.getUsuario()?.rol === 'admin';
  }
}
