import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { UserService } from '../../services/account/user.service';

@Component({
  selector: 'app-calendar',
  standalone: true,
  template: '',
})
export class CalendarPage implements OnInit {
  private router = inject(Router);
  private userService = inject(UserService);

  ngOnInit(): void {
    const userProfile = this.userService.getUserInfo()();
    
    if (!userProfile) {
      // If user profile not loaded, navigate to client calendar by default
      void this.router.navigateByUrl('/tabs/calender/client', { replaceUrl: true });
      return;
    }
    
    // Route to appropriate calendar based on user type
    const isTrainer = userProfile.accountType === 'trainer';
    const calendarRoute = isTrainer ? '/tabs/calender/trainer' : '/tabs/calender/client';
    
    void this.router.navigateByUrl(calendarRoute, { replaceUrl: true });
  }
}
