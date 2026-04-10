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
  trophyOutline,
} from 'ionicons/icons';
import { filter } from 'rxjs/operators';
import { UserService } from '../../services/account/user.service';

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
  calendarHref = '/tabs/calender/client';
  currentUrl = '';

  constructor(
    private router: Router,
    private userService: UserService
  ) {
    addIcons({
      homeOutline,
      calendarOutline,
      chatbubbleEllipsesSharp,
      trophyOutline,
    });

    this.currentUrl = this.router.url;
    this.updateTabBarVisibility(this.router.url);
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe((event) => {
        const nav = event as NavigationEnd;
        this.currentUrl = nav.urlAfterRedirects;
        this.updateTabBarVisibility(nav.urlAfterRedirects);
        this.updateCalendarHref(nav.urlAfterRedirects);
      });

    this.updateCalendarHref(this.router.url);
  }

  private updateTabBarVisibility(url: string): void {
    this.showTabBar = !url.includes('/workout-chatbot');
  }

  private updateCalendarHref(url: string): void {
    if (url.includes('/tabs/calender/trainer')) {
      this.calendarHref = '/tabs/calender/trainer';
      return;
    }

    if (url.includes('/tabs/calender/client')) {
      this.calendarHref = '/tabs/calender/client';
      return;
    }

    const userProfile = this.userService.getUserInfo()();
    this.calendarHref = userProfile?.accountType === 'trainer'
      ? '/tabs/calender/trainer'
      : '/tabs/calender/client';
  }

  onCalendarTabClick(event: Event): void {
    const isOnCalendar =
      this.currentUrl.includes('/tabs/calender/client') ||
      this.currentUrl.includes('/tabs/calender/trainer') ||
      this.currentUrl.endsWith('/tabs/calender') ||
      this.currentUrl.endsWith('/tabs/calender/');

    event.preventDefault();
    event.stopPropagation();

    if (isOnCalendar) {
      return;
    }

    void this.router.navigateByUrl(this.calendarHref);
  }
}
