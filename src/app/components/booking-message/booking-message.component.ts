import { Component, OnInit, Input, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonButton, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { calendarOutline } from 'ionicons/icons';
import { ROUTE_PATHS } from '../../app.routes';

@Component({
  selector: 'app-booking-message',
  templateUrl: './booking-message.component.html',
  styleUrls: ['./booking-message.component.scss'],
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  imports: [CommonModule, IonButton, IonIcon]
})
export class BookingMessageComponent implements OnInit {
  @Input() trainerId: string = '';
  @Input() trainerName: string = 'Your trainer';

  constructor(private router: Router) {
    addIcons({ calendarOutline });
  }

  ngOnInit() {
    // Validate that we have a trainer ID
    if (!this.trainerId) {
      console.error('BookingMessageComponent: No trainer ID provided');
    }
  }

  /**
   * Navigate to the session booking page with the trainer ID
   */
  navigateToBooking() {
    if (this.trainerId) {
        this.router.navigate(['/session-booking', this.trainerId]);
    } else {
      console.error('Cannot navigate to booking: No trainer ID provided');
    }
  }
}

