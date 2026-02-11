import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { IonContent, IonSegment, IonSegmentButton, IonLabel, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { chatbubblesOutline, fitnessOutline, peopleOutline } from 'ionicons/icons';
import { HeaderComponent } from '../../components/header/header.component';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-chats',
  standalone: true,
  templateUrl: './chats.page.html',
  styleUrls: ['./chats.page.scss'],
  imports: [CommonModule, FormsModule, IonContent, IonSegment, IonSegmentButton, IonLabel, IonIcon, HeaderComponent, RouterOutlet],
})
export class ChatsPage implements OnInit {
  selectedSegment: string = 'messages';

  constructor(private router: Router) {
    addIcons({ chatbubblesOutline, fitnessOutline, peopleOutline });
    
    // Listen to navigation events to update segment
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe(() => {
      this.updateSegmentFromRoute();
    });
  }

  ngOnInit() {
    this.updateSegmentFromRoute();
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
    switch (this.selectedSegment) {
      case 'messages':
        this.router.navigate(['/tabs/chats/client-chats']);
        break;
      case 'ai-coach':
        this.router.navigate(['/tabs/chats/workout-chatbot']);
        break;
      case 'groups':
        this.router.navigate(['/tabs/chats/groups']);
        break;
    }
  }
}
