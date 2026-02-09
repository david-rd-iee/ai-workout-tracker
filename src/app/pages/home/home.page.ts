// src/app/pages/home/home.page.ts
import { Component, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { HeaderComponent } from 'src/app/components/header/header.component';
import { UserService } from 'src/app/services/account/user.service';
import { IonContent, IonCard, IonCardContent, IonIcon, IonButton } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { 
  personCircleOutline, 
  trophyOutline, 
  fitnessOutline, 
  peopleOutline, 
  chatbubblesOutline,
  addCircle,
  flame,
  calendarOutline,
  chevronForward,
  personOutline
} from 'ionicons/icons';

interface Exercise {
  name: string;
  sets?: number;
  reps?: number;
  weight?: number;
  weightUnit?: string;
  duration?: number;
}

interface NextWorkout {
  title: string;
  date: Date;
  type?: string;
  duration?: number;
  exercises?: Exercise[];
  notes?: string;
}

interface UpcomingSession {
  id: string;
  trainerName: string;
  date: Date;
  notes?: string;
  duration?: number;
}

@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [CommonModule, IonContent, IonCard, IonCardContent, IonIcon, IonButton, HeaderComponent],
})
export class HomePage implements OnInit {
  currentDate = new Date();
  userName = computed(() => {
    const userProfile = this.userService.getUserInfo()();
    return userProfile?.firstName || 'User';
  });
  currentStreak = 0;
  nextWorkout: NextWorkout | null = null;
  upcomingSessions: UpcomingSession[] = [];

  constructor(
    private router: Router,
    private userService: UserService
  ) {
    addIcons({ 
      personCircleOutline, 
      trophyOutline, 
      fitnessOutline, 
      peopleOutline, 
      chatbubblesOutline,
      addCircle,
      flame,
      calendarOutline,
      chevronForward,
      personOutline
    });
  }

  ngOnInit() {
    this.loadUserData();
  }

  loadUserData() {
    // TODO: Load actual streak data from service
    this.currentStreak = 5; // Placeholder
    
    // Fake workout for demonstration
    this.nextWorkout = {
      title: 'Upper Body Strength',
      date: new Date(Date.now() + 86400000), // Tomorrow
      type: 'Strength Training',
      duration: 60,
      exercises: [
        { name: 'Bench Press', sets: 4, reps: 8, weight: 135, weightUnit: 'lbs' },
        { name: 'Pull-ups', sets: 3, reps: 10 },
        { name: 'Shoulder Press', sets: 3, reps: 12, weight: 45, weightUnit: 'lbs' },
        { name: 'Bicep Curls', sets: 3, reps: 15, weight: 25, weightUnit: 'lbs' },
        { name: 'Tricep Dips', sets: 3, reps: 12 }
      ],
      notes: 'Focus on jerking it harder. No rest between sets.'
    };

    // TODO: Load upcoming sessions from booking service
    // Placeholder data for demonstration
    this.upcomingSessions = [
      {
        id: '1',
        trainerName: 'John Smith',
        date: new Date(Date.now() + 172800000), // 2 days from now
        notes: 'Focus on jerking it harder. No rest between sets.',
        duration: 60
      },
      {
        id: '2',
        trainerName: 'Sarah Johnson',
        date: new Date(Date.now() + 432000000), // 5 days from now
        notes: '😳',
        duration: 45
      }
    ];
  }

  startWorkout() {
    // Navigate to workout chatbot to start logging
    this.router.navigate(['/tabs/chats/workout-chatbot']);
  }

  viewStreak() {
    // TODO: Navigate to streak page (to be created)
    // For now, navigate to profile which might show stats
    this.router.navigate(['/tabs/profile']);
  }

  viewNextWorkout() {
    if (this.nextWorkout) {
      // Navigate to workout details page with workout data
      this.router.navigate(['/workout-details'], { 
        state: { workout: this.nextWorkout } 
      });
    } else {
      // Navigate to calendar to schedule a workout
      this.router.navigate(['/tabs/calender']);
    }
  }

  viewSessionDetails(session: UpcomingSession) {
    // Navigate to calendar to view session details
    this.router.navigate(['/tabs/calender']);
  }

  navigateTo(path: string): void {
    this.router?.navigate([path]);
  }
}
