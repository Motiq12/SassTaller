import { Component } from '@angular/core';
import { AuthService } from '../../services/auth.service';

@Component({
  standalone: false,
  selector: 'app-tabs',
  templateUrl: './tabs.page.html',
  styleUrls: ['./tabs.page.scss'],
})
export class TabsPage {
  constructor(private auth: AuthService) {}

  get esAdmin(): boolean {
    return this.auth.getUsuario()?.rol === 'admin';
  }
}
