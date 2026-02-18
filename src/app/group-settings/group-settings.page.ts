import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { NavController } from '@ionic/angular';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowBackOutline } from 'ionicons/icons';

@Component({
  selector: 'app-group-settings',
  templateUrl: './group-settings.page.html',
  styleUrls: ['./group-settings.page.scss'],
  standalone: true,
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    CommonModule,
  ],
})
export class GroupSettingsPage implements OnInit {
  private route = inject(ActivatedRoute);
  private navCtrl = inject(NavController);
  groupId = '';

  constructor() {
    addIcons({ arrowBackOutline });
  }

  ngOnInit() {
    this.groupId = this.route.snapshot.paramMap.get('groupID') ?? '';
  }

  goBack(): void {
    if (!this.groupId) {
      this.navCtrl.navigateBack('/groups', {
        animated: true,
        animationDirection: 'back',
      });
      return;
    }

    this.navCtrl.navigateBack(`/leaderboard/${this.groupId}`, {
      animated: true,
      animationDirection: 'back',
    });
  }
}
