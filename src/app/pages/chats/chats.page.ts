import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { HeaderComponent } from '../../components/header/header.component';

@Component({
  selector: 'app-chats',
  standalone: true,
  templateUrl: './chats.page.html',
  styleUrls: ['./chats.page.scss'],
  imports: [CommonModule, IonContent, HeaderComponent, RouterOutlet],
})
export class ChatsPage implements OnInit {
  constructor(private router: Router) {}

  ngOnInit(): void {
    this.ensureDefaultChildRoute();
  }

  private ensureDefaultChildRoute(): void {
    const url = this.router.url;
    if (url.endsWith('/chats') || url.endsWith('/chats/')) {
      void this.router.navigateByUrl('/tabs/chats/client-chats', { replaceUrl: true });
    }
  }
}
