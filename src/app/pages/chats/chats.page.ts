import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { IonContent, IonSegment, IonSegmentButton, IonLabel, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { chatbubblesOutline, fitnessOutline, peopleOutline } from 'ionicons/icons';
import { HeaderComponent } from '../../components/header/header.component';
import { filter } from 'rxjs/operators';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-chats',
  standalone: true,
  templateUrl: './chats.page.html',
  styleUrls: ['./chats.page.scss'],
  imports: [CommonModule, FormsModule, IonContent, IonSegment, IonSegmentButton, IonLabel, IonIcon, HeaderComponent, RouterOutlet],
})
export class ChatsPage implements OnInit, OnDestroy {
  selectedSegment: string = 'messages';
  private routerEventsSub?: Subscription;

  constructor(private router: Router) {
    addIcons({ chatbubblesOutline, fitnessOutline, peopleOutline });
    
    // Listen to navigation events to update segment
    this.routerEventsSub = this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe(() => {
      this.updateSegmentFromRoute();
    });
  }

  ngOnInit() {
    this.updateSegmentFromRoute();
  }

  ngOnDestroy(): void {
    this.routerEventsSub?.unsubscribe();
  }

  private updateSegmentFromRoute() {
    const url = this.router.url;
    if (url.includes('client-chats')) {
      this.selectedSegment = 'messages';
    } else if (url.includes('workout-chatbot')) {
      this.selectedSegment = 'ai-coach';
    } else if (url.includes('groups')) {
      this.selectedSegment = 'groups';
    } else if (url.endsWith('/chats') || url.endsWith('/chats/')) {
      // If at base chats route, navigate to the selected segment
      this.segmentChanged();
    }
  }

  segmentChanged() {
    let targetRoute = '/tabs/chats/client-chats';
    switch (this.selectedSegment) {
      case 'messages':
        targetRoute = '/tabs/chats/client-chats';
        break;
      case 'ai-coach':
        targetRoute = '/tabs/chats/workout-chatbot';
        break;
      case 'groups':
        targetRoute = '/tabs/chats/groups';
        break;
    }

    if (this.router.url !== targetRoute) {
      void this.router.navigateByUrl(targetRoute);
    }
  }
}
