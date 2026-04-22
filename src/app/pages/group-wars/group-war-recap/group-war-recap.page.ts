import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IonicModule, NavController } from '@ionic/angular';
import { Subscription } from 'rxjs';

import {
  GroupWarRecap,
  GroupWarRecapContributorSummary,
  GroupWarRecapExerciseSummary,
} from '../../../models/group-war.model';
import { GroupWarService } from '../../../services/group-war.service';

@Component({
  selector: 'app-group-war-recap',
  standalone: true,
  templateUrl: './group-war-recap.page.html',
  styleUrls: ['./group-war-recap.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class GroupWarRecapPage implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private navCtrl = inject(NavController);
  private groupWarService = inject(GroupWarService);

  warId = '';
  loading = true;
  errorMessage = '';
  recap?: GroupWarRecap;

  private recapSub?: Subscription;

  ngOnInit(): void {
    const warId = this.route.snapshot.paramMap.get('warId');
    if (!warId) {
      this.loading = false;
      this.errorMessage = 'Missing war ID.';
      return;
    }

    this.warId = warId;
    this.recapSub = this.groupWarService.watchWarRecap(warId).subscribe({
      next: (recap) => {
        this.loading = false;
        if (!recap) {
          this.errorMessage = 'Recap not available yet.';
          this.recap = undefined;
          return;
        }

        this.errorMessage = '';
        this.recap = recap;
      },
      error: (error) => {
        console.error('[GroupWarRecapPage] Failed to load recap', error);
        this.loading = false;
        this.errorMessage = 'Could not load war recap.';
        this.recap = undefined;
      },
    });
  }

  ngOnDestroy(): void {
    this.recapSub?.unsubscribe();
  }

  goBack(): void {
    this.navCtrl.navigateBack('/groups', {
      animated: true,
      animationDirection: 'back',
    });
  }

  get winnerBannerText(): string {
    if (!this.recap) {
      return '';
    }

    if (this.recap.winner?.type === 'tie' || !this.recap.winnerGroupId) {
      return 'Tie War';
    }

    return `${this.recap.winner?.groupName || 'Winning Group'} Wins`;
  }

  get challengerWarriorCard(): GroupWarRecapContributorSummary | null {
    return this.recap?.topContributorByTeam?.challenger || null;
  }

  get opponentWarriorCard(): GroupWarRecapContributorSummary | null {
    return this.recap?.topContributorByTeam?.opponent || null;
  }

  get challengerMostUsedExercise(): GroupWarRecapExerciseSummary | null {
    return this.recap?.mostUsedExerciseByTeam?.challenger || null;
  }

  get opponentMostUsedExercise(): GroupWarRecapExerciseSummary | null {
    return this.recap?.mostUsedExerciseByTeam?.opponent || null;
  }

  shareLabel(value: number | undefined): string {
    if (!Number.isFinite(Number(value))) {
      return '0%';
    }
    return `${Math.round(Number(value) * 100)}%`;
  }
}
