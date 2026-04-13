import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonBackButton,
  IonButton,
  IonItem,
  IonLabel,
  IonSelect,
  IonSelectOption,
} from '@ionic/angular/standalone';
import type {
  CardioHistoryEntry,
  OtherHistoryEntry,
  StrengthHistoryEntry,
  WorkoutHistoryDateGroup,
} from '../../models/workout-history.model';

type CsvTableType = 'Strength' | 'Cardio' | 'Other';

@Component({
  selector: 'app-workout-history-csv',
  standalone: true,
  templateUrl: './workout-history-csv.page.html',
  styleUrls: ['./workout-history-csv.page.scss'],
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonButton,
    IonItem,
    IonLabel,
    IonSelect,
    IonSelectOption,
  ],
})
export class WorkoutHistoryCsvPage implements OnInit {
  isLoading = false;
  pageTitle = 'Workout CSV View';
  selectedType: CsvTableType = 'Strength';
  historyGroups: WorkoutHistoryDateGroup[] = [];
  tableHeaders: string[] = [];
  tableRows: string[][] = [];

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    const clientName = (this.route.snapshot.queryParamMap.get('clientName') || '').trim();
    this.pageTitle = clientName ? `${clientName} Workout CSV` : 'Workout CSV View';

    const state = window.history.state as Record<string, unknown> | undefined;
    const candidate = state?.['historyGroups'];
    this.historyGroups = this.normalizeHistoryGroups(candidate);
    this.refreshPreview();
  }

  refreshPreview(): void {
    const model = this.buildTableModel(this.selectedType);
    this.tableHeaders = model.header;
    this.tableRows = model.rows;
  }

  exportCsv(): void {
    if (this.historyGroups.length === 0) {
      return;
    }

    const sections = [
      this.buildSectionCsv('Strength Table', 'Strength'),
      this.buildSectionCsv('Cardio Table', 'Cardio'),
      this.buildSectionCsv('Other Table', 'Other'),
    ];

    const csv = sections.join('\n\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const dateTag = new Date().toISOString().slice(0, 10);
    const filename = `workout_tables_${dateTag}.csv`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  private buildSectionCsv(label: string, type: CsvTableType): string {
    return `${label}\n${this.buildCsvForType(type)}`;
  }

  private buildCsvForType(type: CsvTableType): string {
    const model = this.buildTableModel(type);
    return this.toCsvText(model.header, model.rows);
  }

  private buildTableModel(type: CsvTableType): { header: string[]; rows: string[][] } {
    if (type === 'Strength') {
      return {
        header: ['Date', 'Exercise', 'Sets', 'Reps', 'Weights (kg)', 'Calories Burned', 'Trainer Notes'],
        rows: this.buildRowsForType(type),
      };
    }

    if (type === 'Cardio') {
      return {
        header: ['Date', 'Exercise', 'Distance', 'Time', 'Calories Burned', 'Trainer Notes'],
        rows: this.buildRowsForType(type),
      };
    }

    return {
      header: ['Date', 'Exercise', 'Details', 'Calories Burned', 'Trainer Notes'],
      rows: this.buildRowsForType(type),
    };
  }

  private buildRowsForType(type: CsvTableType): string[][] {
    const rows: string[][] = [];

    this.historyGroups.forEach((group) => {
      if (type === 'Strength') {
        group.strength.forEach((entry) => {
          rows.push([
            group.date,
            entry.exercise,
            String(entry.sets),
            String(entry.reps),
            entry.weights,
            String(entry.caloriesBurned),
            group.trainerNotes,
          ]);
        });
        return;
      }

      if (type === 'Cardio') {
        group.cardio.forEach((entry) => {
          rows.push([
            group.date,
            entry.exercise,
            entry.distance,
            entry.time,
            String(entry.caloriesBurned),
            group.trainerNotes,
          ]);
        });
        return;
      }

      group.other.forEach((entry) => {
        rows.push([
          group.date,
          entry.exercise,
          entry.details,
          String(entry.caloriesBurned),
          group.trainerNotes,
        ]);
      });
    });

    return rows;
  }

  private toCsvText(header: string[], rows: string[][]): string {
    const lines = [header.map((cell) => this.csvEscape(cell)).join(',')];
    rows.forEach((row) => {
      lines.push(row.map((cell) => this.csvEscape(cell)).join(','));
    });
    return lines.join('\n');
  }

  private csvEscape(value: string): string {
    const v = String(value ?? '');
    if (/[",\n]/.test(v)) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  }

  private normalizeHistoryGroups(candidate: unknown): WorkoutHistoryDateGroup[] {
    if (!Array.isArray(candidate)) {
      return [];
    }

    return candidate
      .filter((entry) => !!entry && typeof entry === 'object')
      .map((entry) => {
        const record = entry as Record<string, unknown>;
        return {
          date: this.readText(record['date']) || new Date().toISOString().slice(0, 10),
          strength: this.normalizeStrengthEntries(record['strength']),
          cardio: this.normalizeCardioEntries(record['cardio']),
          other: this.normalizeOtherEntries(record['other']),
          totalCaloriesBurned: this.toRoundedNonNegative(record['totalCaloriesBurned']),
          trainerNotes: this.readText(record['trainerNotes']),
        };
      });
  }

  private normalizeStrengthEntries(value: unknown): StrengthHistoryEntry[] {
    return this.toObjectArray(value).map((entry) => ({
      exercise: this.readText(entry['exercise']) || 'Exercise',
      sets: this.toRoundedNonNegative(entry['sets']),
      reps: this.toRoundedNonNegative(entry['reps']),
      weights: this.readText(entry['weights']) || 'bodyweight',
      caloriesBurned: this.toRoundedNonNegative(entry['caloriesBurned']),
    }));
  }

  private normalizeCardioEntries(value: unknown): CardioHistoryEntry[] {
    return this.toObjectArray(value).map((entry) => ({
      exercise: this.readText(entry['exercise']) || 'Cardio Activity',
      distance: this.readText(entry['distance']),
      time: this.readText(entry['time']),
      caloriesBurned: this.toRoundedNonNegative(entry['caloriesBurned']),
    }));
  }

  private normalizeOtherEntries(value: unknown): OtherHistoryEntry[] {
    return this.toObjectArray(value).map((entry) => ({
      exercise: this.readText(entry['exercise']) || 'Other Activity',
      details: this.readText(entry['details']),
      caloriesBurned: this.toRoundedNonNegative(entry['caloriesBurned']),
    }));
  }

  private toObjectArray(value: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(value)) {
      return value.filter(
        (entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object'
      );
    }

    if (value && typeof value === 'object') {
      return [value as Record<string, unknown>];
    }

    return [];
  }

  private readText(value: unknown): string {
    if (typeof value !== 'string') {
      return '';
    }
    return value.trim();
  }

  private toRoundedNonNegative(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }
    return Math.round(parsed);
  }
}
