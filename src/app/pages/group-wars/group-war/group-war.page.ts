import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Subscription } from 'rxjs';

import { GroupWar, GroupWarMemberStanding } from '../../../models/group-war.model';
import { GroupService } from '../../../services/group.service';
import { GroupWarService } from '../../../services/group-war.service';
import { HeaderComponent } from '../../../components/header/header.component';

@Component({
  selector: 'app-group-war',
  standalone: true,
  templateUrl: './group-war.page.html',
  styleUrls: ['./group-war.page.scss'],
  imports: [CommonModule, IonicModule, HeaderComponent],
})
export class GroupWarPage implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private groupService = inject(GroupService);
  private groupWarService = inject(GroupWarService);

  groupId = '';
  groupName = 'Group';
  opponentGroupId = '';
  opponentGroupName = 'Opponent';

  loading = true;
  errorMessage = '';

  war?: GroupWar;
  memberStandings: GroupWarMemberStanding[] = [];
  countdownLabel = '--';

  private warSub?: Subscription;
  private groupSub?: Subscription;
  private opponentGroupSub?: Subscription;
  private standingsSub?: Subscription;
  private countdownIntervalId?: ReturnType<typeof setInterval>;
  private standingsWarId: string | null = null;

  ngOnInit(): void {
    const groupId = this.route.snapshot.paramMap.get('groupId');
    if (!groupId) {
      this.loading = false;
      this.errorMessage = 'Missing group ID.';
      return;
    }

    this.groupId = groupId;
    this.groupSub = this.groupService.getGroup(groupId).subscribe((group) => {
      this.groupName = group?.name || 'Group';
    });

    this.warSub = this.groupWarService.watchActiveWarForGroup(groupId).subscribe({
      next: (war) => {
        this.loading = false;
        if (!war) {
          this.war = undefined;
          this.errorMessage = 'No active war is running for this group.';
          this.opponentGroupId = '';
          this.opponentGroupName = 'Opponent';
          this.memberStandings = [];
          this.standingsSub?.unsubscribe();
          this.standingsSub = undefined;
          this.standingsWarId = null;
          this.stopCountdown();
          return;
        }

        this.errorMessage = '';
        this.war = war;
        this.resolveOpponent(war);
        this.syncStandingsSubscription(war.warId);
        this.startCountdown(war);
      },
      error: (error) => {
        console.error('[GroupWarPage] Failed to load active war', error);
        this.loading = false;
        this.errorMessage = 'Could not load active war.';
      },
    });
  }

  get hasWar(): boolean {
    return !!this.war;
  }

  get myScore(): number {
    if (!this.war) {
      return 0;
    }
    return this.groupId === this.war.challengerGroupId
      ? this.war.challengerScoreTotal
      : this.war.opponentScoreTotal;
  }

  get opponentScore(): number {
    if (!this.war) {
      return 0;
    }
    return this.groupId === this.war.challengerGroupId
      ? this.war.opponentScoreTotal
      : this.war.challengerScoreTotal;
  }

  get myCardioPoints(): number {
    return this.resolveSideValue(this.groupId, 'groupACardioPoints', 'groupBCardioPoints');
  }

  get myStrengthPoints(): number {
    return this.resolveSideValue(this.groupId, 'groupAStrengthPoints', 'groupBStrengthPoints');
  }

  get opponentCardioPoints(): number {
    return this.resolveSideValue(this.opponentGroupId, 'groupACardioPoints', 'groupBCardioPoints');
  }

  get opponentStrengthPoints(): number {
    return this.resolveSideValue(this.opponentGroupId, 'groupAStrengthPoints', 'groupBStrengthPoints');
  }

  get myCardioSharePercent(): number {
    return this.toSharePercent(this.myCardioPoints, this.myStrengthPoints);
  }

  get myStrengthSharePercent(): number {
    return this.toSharePercent(this.myStrengthPoints, this.myCardioPoints);
  }

  get opponentCardioSharePercent(): number {
    return this.toSharePercent(this.opponentCardioPoints, this.opponentStrengthPoints);
  }

  get opponentStrengthSharePercent(): number {
    return this.toSharePercent(this.opponentStrengthPoints, this.opponentCardioPoints);
  }

  ngOnDestroy(): void {
    this.warSub?.unsubscribe();
    this.groupSub?.unsubscribe();
    this.opponentGroupSub?.unsubscribe();
    this.standingsSub?.unsubscribe();
    this.stopCountdown();
  }

  private syncStandingsSubscription(warId: string): void {
    const normalizedWarId = String(warId ?? '').trim();
    if (!normalizedWarId || this.standingsWarId === normalizedWarId) {
      return;
    }

    this.standingsSub?.unsubscribe();
    this.memberStandings = [];
    this.standingsWarId = normalizedWarId;
    this.standingsSub = this.groupWarService.watchWarMemberStandings(normalizedWarId).subscribe({
      next: (standings) => {
        this.memberStandings = standings;
      },
      error: (error) => {
        console.warn('[GroupWarPage] Failed to load member standings', error);
        this.memberStandings = [];
      },
    });
  }

  private resolveOpponent(war: GroupWar): void {
    const isChallenger = war.challengerGroupId === this.groupId;
    this.opponentGroupId = isChallenger ? war.opponentGroupId : war.challengerGroupId;
    if (!this.opponentGroupId) {
      this.opponentGroupName = 'Opponent';
      return;
    }

    this.opponentGroupSub?.unsubscribe();
    this.opponentGroupSub = this.groupService.getGroup(this.opponentGroupId).subscribe((group) => {
      this.opponentGroupName = group?.name || this.opponentGroupId;
    });
  }

  private startCountdown(war: GroupWar): void {
    this.stopCountdown();
    this.updateCountdown(war);

    const endAt = war.endAt ?? war.endsAt;
    if (!endAt) {
      return;
    }

    this.countdownIntervalId = setInterval(() => {
      this.updateCountdown(war);
    }, 1000);
  }

  private updateCountdown(war: GroupWar): void {
    const endAt = war.endAt ?? war.endsAt;
    if (!endAt) {
      this.countdownLabel = 'No countdown available';
      return;
    }

    const diffMs = endAt.toMillis() - Date.now();
    if (diffMs <= 0) {
      this.countdownLabel = 'Finalizing';
      return;
    }

    const totalSeconds = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (days > 0) {
      this.countdownLabel = `${days}d ${this.pad(hours)}h ${this.pad(minutes)}m`;
      return;
    }

    this.countdownLabel = `${this.pad(hours)}:${this.pad(minutes)}:${this.pad(seconds)}`;
  }

  private stopCountdown(): void {
    if (!this.countdownIntervalId) {
      return;
    }

    clearInterval(this.countdownIntervalId);
    this.countdownIntervalId = undefined;
  }

  private resolveSideValue(
    targetGroupId: string,
    groupAField: 'groupACardioPoints' | 'groupAStrengthPoints',
    groupBField: 'groupBCardioPoints' | 'groupBStrengthPoints'
  ): number {
    if (!this.war || !targetGroupId) {
      return 0;
    }

    const groupAId = this.war.groupAId || this.war.challengerGroupId;
    const groupBId = this.war.groupBId || this.war.opponentGroupId;
    if (targetGroupId === groupAId) {
      return Math.max(0, Math.round(Number(this.war[groupAField] ?? 0)));
    }
    if (targetGroupId === groupBId) {
      return Math.max(0, Math.round(Number(this.war[groupBField] ?? 0)));
    }
    return 0;
  }

  private toSharePercent(primary: number, secondary: number): number {
    const total = Math.max(0, primary) + Math.max(0, secondary);
    if (total <= 0) {
      return 0;
    }
    return Math.round((Math.max(0, primary) / total) * 100);
  }

  private pad(value: number): string {
    return String(Math.max(0, value)).padStart(2, '0');
  }
}
