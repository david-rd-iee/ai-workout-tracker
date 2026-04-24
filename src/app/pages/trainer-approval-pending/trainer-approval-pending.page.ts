import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonButton, IonContent } from '@ionic/angular/standalone';
import { UserService } from 'src/app/services/account/user.service';
import { AccountService } from 'src/app/services/account/account.service';

@Component({
  selector: 'app-trainer-approval-pending',
  standalone: true,
  templateUrl: './trainer-approval-pending.page.html',
  styleUrls: ['./trainer-approval-pending.page.scss'],
  imports: [CommonModule, IonButton, IonContent],
})
export class TrainerApprovalPendingPage {
  private readonly userService = inject(UserService);
  private readonly accountService = inject(AccountService);
  private readonly router = inject(Router);

  isCheckingStatus = false;
  errorMessage = '';

  async recheckStatus(): Promise<void> {
    this.errorMessage = '';
    this.isCheckingStatus = true;
    try {
      const loaded = await this.userService.loadUserProfile();
      if (loaded) {
        await this.router.navigateByUrl('/tabs/home', { replaceUrl: true });
        return;
      }
    } catch (error) {
      console.error('[TrainerApprovalPendingPage] Failed to recheck trainer approval:', error);
      this.errorMessage = 'Unable to refresh approval status right now.';
    } finally {
      this.isCheckingStatus = false;
    }
  }

  async signOut(): Promise<void> {
    await this.accountService.logout();
  }
}
