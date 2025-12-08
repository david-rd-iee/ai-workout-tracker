import { Component } from '@angular/core';
import {
  IonTabs,
  IonRouterOutlet,
  IonTabBar,
  IonTabButton,
  IonIcon,
  IonLabel
} from '@ionic/angular/standalone';

import { RouterLink, RouterLinkActive } from '@angular/router';

import { addIcons } from 'ionicons';
import {
  homeOutline,
  peopleOutline,
  podiumOutline,
  chatbubbleEllipsesSharp,
  personOutline,
} from 'ionicons/icons';

@Component({
  selector: 'app-tabs',
  standalone: true,
  templateUrl: './tabs.page.html',
  styleUrls: ['./tabs.page.scss'],
  imports: [
    IonTabs,
    IonRouterOutlet,
    IonTabBar,
    IonTabButton,
    IonIcon,
    IonLabel,
    RouterLink,
    RouterLinkActive,
  ],
})
export class TabsPage {
  constructor() {
    addIcons({
      homeOutline,
      peopleOutline,
      podiumOutline,
      chatbubbleEllipsesSharp,
      personOutline,
    });
  }
}
