import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import {
  IonTabs,
  IonTabBar,
  IonTabButton,
  IonIcon,
  IonLabel
} from '@ionic/angular/standalone';

import { addIcons } from 'ionicons';
import {
  homeOutline,
  calendarOutline,
  chatbubbleEllipsesSharp,
} from 'ionicons/icons';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-tabs',
  standalone: true,
  templateUrl: './tabs.page.html',
  styleUrls: ['./tabs.page.scss'],
  imports: [
    CommonModule,
    IonTabs,
    IonTabBar,
    IonTabButton,
    IonIcon,
    IonLabel,
  ],
})
export class TabsPage {
  showTabBar = true;

  constructor(private router: Router) {
    addIcons({
      homeOutline,
      calendarOutline,
      chatbubbleEllipsesSharp,
    });

    this.updateTabBarVisibility(this.router.url);
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe((event) => {
        const nav = event as NavigationEnd;
        this.updateTabBarVisibility(nav.urlAfterRedirects);
      });
  }

  private updateTabBarVisibility(url: string): void {
    this.showTabBar = !url.includes('/workout-chatbot');
  }
}
