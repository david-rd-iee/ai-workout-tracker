import { CommonModule } from '@angular/common';
import { Component, effect, EnvironmentInjector, inject } from '@angular/core';

import { IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, IonButton } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { homeOutline, calendarOutline, listOutline, chatbubbleEllipsesSharp, fileTrayFullOutline } from 'ionicons/icons';
import { AccountService } from 'src/app/services/account/account.service';
import { UserService } from 'src/app/services/account/user.service';

@Component({
  selector: 'app-tabs',
  templateUrl: 'tabs.page.html',
  styleUrls: ['tabs.page.scss'],
  standalone: true,
  imports: [IonTabs, IonTabBar, IonTabButton, IonIcon, IonTabButton, CommonModule],
})
export class TabsPage {
  public environmentInjector = inject(EnvironmentInjector);
  userType: 'trainer' | 'client' = 'client';

  constructor(
    private userService: UserService,
    private accountService: AccountService,
  ) {
    effect(() => {
      const info = this.userService.getUserInfo()();
      if (info) {
        this.userType = info.accountType;
      }
    });
    // this.userType = this.userService.getProfileType();
    addIcons({
      homeOutline,
      calendarOutline,
      listOutline,
      chatbubbleEllipsesSharp,
      fileTrayFullOutline
    });
  }
}
