import { Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController } from '@ionic/angular';

import { GroupService } from '../../services/group.service';
import { Group } from '../../models/groups.model';
import { AppUser } from '../../models/user.model';

import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { Subscription } from 'rxjs';
import { Router } from '@angular/router';

@Component({
  selector: 'app-groups',
  standalone: true,
  templateUrl: './groups.page.html',
  styleUrls: ['./groups.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class GroupsPage implements OnDestroy {
  appUser?: AppUser;
  groups: Group[] = [];
  loading = true;
  errorMessage: string | null = null;

  private authUnsub?: () => void;
  private sub?: Subscription;

  constructor(
    private auth: Auth,
    private groupService: GroupService,
    private alertCtrl: AlertController,
    private router: Router
  ) {
    // Listen for auth changes
    this.authUnsub = onAuthStateChanged(this.auth, (user) => {
      if (!user) {
        this.loading = false;
        this.errorMessage = 'No logged-in user.';
        this.appUser = undefined;
        this.groups = [];
        return;
      }

      this.loading = true;
      this.errorMessage = null;

      // Load AppUser + groups
      this.sub?.unsubscribe();
      this.sub = this.groupService.getUserGroups(user.uid).subscribe({
        next: ({ user, groups }) => {
          this.appUser = user;
          this.groups = groups;
          this.loading = false;
        },
        error: (err) => {
          console.error('[GroupsPage] Error loading groups:', err);
          this.errorMessage = err?.message ?? 'Error loading groups';
          this.loading = false;
        },
      });
    });
  }

  get hasPT(): boolean {
    return !!this.appUser?.ptUID;
  }

  get hasGroups(): boolean {
    return (this.appUser?.groups?.length ?? 0) > 0;
  }

  /**
   * Called when the user taps "Start a group" or the + button.
   * Creates a non-PT group owned by this user.
   */
  async onCreateGroup(): Promise<void> {
    if (!this.appUser) {
      return;
    }

    const alert = await this.alertCtrl.create({
      header: 'Create Group',
      inputs: [
        {
          name: 'name',
          type: 'text',
          placeholder: 'My Workout Group',
        },
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
        },
        {
          text: 'Create',
          handler: async (data) => {
            const name: string = (data?.name || '').trim() || 'My Group';
            try {
              this.loading = true;
              const newGroupId = await this.groupService.createGroupForOwner(
                this.appUser!.userId,
                name,
                false // isPTGroup = false for user-created friend groups
              );
              console.log('[GroupsPage] Created group with ID:', newGroupId);
              this.loading = false;
            } catch (err) {
              console.error('[GroupsPage] Error creating group:', err);
              this.errorMessage = (err as any)?.message ?? 'Error creating group';
              this.loading = false;
            }
          },
        },
      ],
    });

    await alert.present();
  }

  /**
   * Called when a group item is tapped.
   * For now, we just log — later you can navigate to a group-specific leaderboard.
   */
  onGroupSelected(group: Group): void {
    console.log('[GroupsPage] Selected group:', group);

    // Example navigation idea (when you implement group-specific leaderboard):
    // this.router.navigate(['/tabs/leaderboard'], { queryParams: { groupId: group.id } });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.authUnsub?.();
  }
}
