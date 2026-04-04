import { Component, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import {
  AlertController,
  IonButton,
  IonCard,
  IonCardContent,
  IonContent,
  IonText,
} from '@ionic/angular/standalone';
import { HeaderComponent } from '../../components/header/header.component';
import {
  CardioRouteBounds,
  CardioRoutePoint,
  CardioTrainingRow,
  WorkoutSessionPerformance,
} from '../../models/workout-session.model';
import {
  StreakUpdateResult,
  WorkoutLogService,
} from '../../services/workout-log.service';
import { UpdateScoreResult } from '../../services/update-score.service';
import { WorkoutSessionFormatterService } from '../../services/workout-session-formatter.service';

type TrackingState = 'idle' | 'starting' | 'running' | 'finished';
type OutdoorActivityType = 'running' | 'biking';

interface TrackedPosition {
  lat: number;
  lng: number;
  accuracyMeters: number;
  timestampMs: number;
}

interface MapTile {
  key: string;
  url: string;
  leftPercent: number;
  topPercent: number;
  sizePercentX: number;
  sizePercentY: number;
}

interface MapViewport {
  zoom: number;
  topLeftX: number;
  topLeftY: number;
}

interface RouteSegment {
  distanceMeters: number;
  durationSeconds: number;
  speedMetersPerSecond: number;
}

interface ActivityDetectionResult {
  exerciseType: OutdoorActivityType;
  averageSpeedMetersPerSecond: number;
  gpsSmoothness: number;
  bikingConfidence: number;
}

@Component({
  selector: 'app-map-tracking-logger',
  standalone: true,
  templateUrl: './map-tracking-logger.page.html',
  styleUrls: ['./map-tracking-logger.page.scss'],
  imports: [
    CommonModule,
    IonButton,
    IonCard,
    IonCardContent,
    IonContent,
    IonText,
    HeaderComponent,
  ],
})
export class MapTrackingLoggerPage implements OnDestroy {
  private readonly workoutLogService = inject(WorkoutLogService);
  private readonly router = inject(Router);
  private readonly alertController = inject(AlertController);
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly workoutSessionFormatter = inject(WorkoutSessionFormatterService);

  private readonly mapWidth = 640;
  private readonly mapHeight = 400;
  private readonly mapPadding = 56;
  private readonly tileSize = 256;
  private readonly maxAcceptedAccuracyMeters = 65;
  private readonly minimumMovementMeters = 5;
  private readonly maxAcceptedSpeedMetersPerSecond = 15;
  private readonly minimumDetectionDistanceMeters = 250;
  private readonly minimumDetectionDurationSeconds = 75;
  private readonly defaultWeightKg = 70;

  trackingState: TrackingState = 'idle';
  statusMessage = 'Start tracking and the app will record your route locally with GPS.';
  errorMessage = '';
  isSavingWorkout = false;

  routePoints: TrackedPosition[] = [];
  distanceMeters = 0;
  userWeightKg = this.defaultWeightKg;

  startedAt: Date | null = null;
  endedAt: Date | null = null;
  nowMs = Date.now();
  detectedActivityType: OutdoorActivityType = 'running';
  activityDetection = this.createDefaultActivityDetection();

  session: WorkoutSessionPerformance = this.createEmptySession();

  mapTiles: MapTile[] = [];
  routePolylinePoints = '';
  markerLeftPercent = 50;
  markerTopPercent = 50;

  private watchId: number | null = null;
  private clockTimerId: number | null = null;
  private lastAcceptedPoint: TrackedPosition | null = null;

  constructor() {
    void this.loadUserWeightKg();
  }

  ngOnDestroy(): void {
    this.stopTrackingWatch();
    this.stopClock();
  }

  get isTracking(): boolean {
    return this.trackingState === 'starting' || this.trackingState === 'running';
  }

  get hasRoute(): boolean {
    return this.routePoints.length > 0;
  }

  get canFinishRun(): boolean {
    return this.isTracking;
  }

  get canLogWorkout(): boolean {
    return this.trackingState === 'finished' && this.distanceMeters > 0 && this.elapsedSeconds > 0;
  }

  get elapsedSeconds(): number {
    if (!this.startedAt) {
      return 0;
    }

    const endMs = this.endedAt
      ? this.endedAt.getTime()
      : this.nowMs;
    return Math.max(0, Math.round((endMs - this.startedAt.getTime()) / 1000));
  }

  get displayDistance(): string {
    return this.formatDistanceText(this.distanceMeters);
  }

  get displayDuration(): string {
    return this.formatDuration(this.elapsedSeconds);
  }

  get displayCalories(): number {
    return this.estimateCalories(this.distanceMeters);
  }

  get detectedActivityLabel(): string {
    return this.formatExerciseName(this.detectedActivityType);
  }

  get detectedActivityHeadline(): string {
    return `Outdoor ${this.detectedActivityLabel}`;
  }

  get hasReliableActivityDetection(): boolean {
    return this.distanceMeters >= this.minimumDetectionDistanceMeters &&
      this.elapsedSeconds >= this.minimumDetectionDurationSeconds &&
      this.routePoints.length >= 4;
  }

  get displayPace(): string {
    if (this.distanceMeters <= 0 || this.elapsedSeconds <= 0) {
      return '--';
    }

    const secondsPerMile = this.elapsedSeconds / (this.distanceMeters / 1609.344);
    return `${this.formatPace(secondsPerMile)} /mi`;
  }

  get displaySpeed(): string {
    if (this.distanceMeters <= 0 || this.elapsedSeconds <= 0) {
      return '--';
    }

    const milesPerHour = (this.distanceMeters / 1609.344) / (this.elapsedSeconds / 3600);
    return `${milesPerHour.toFixed(1)} mph`;
  }

  get displayMovementMetricLabel(): string {
    return this.detectedActivityType === 'biking' ? 'Speed' : 'Pace';
  }

  get displayMovementMetricValue(): string {
    return this.detectedActivityType === 'biking'
      ? this.displaySpeed
      : this.displayPace;
  }

  get startTimeLabel(): string {
    return this.startedAt ? this.formatClockTime(this.startedAt) : '--';
  }

  get currentTimeLabel(): string {
    const source = this.endedAt ?? new Date(this.nowMs);
    return this.formatClockTime(source);
  }

  async startRun(): Promise<void> {
    if (this.isTracking || this.isSavingWorkout) {
      return;
    }

    if (this.trackingState === 'finished') {
      this.resetRun();
    }

    if (!('geolocation' in navigator)) {
      this.errorMessage = 'Location tracking is not available on this device.';
      return;
    }

    this.errorMessage = '';
    this.statusMessage = 'Looking for your GPS signal...';
    this.trackingState = 'starting';
    this.startedAt = new Date();
    this.endedAt = null;
    this.nowMs = Date.now();
    this.detectedActivityType = 'running';
    this.activityDetection = this.createDefaultActivityDetection();
    this.startClock();
    this.stopTrackingWatch();
    this.lastAcceptedPoint = null;

    this.watchId = navigator.geolocation.watchPosition(
      (position) => this.handlePosition(position),
      (error) => this.handleGeolocationError(error),
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000,
      }
    );
  }

  finishRun(): void {
    if (!this.isTracking) {
      return;
    }

    this.stopTrackingWatch();
    this.stopClock();
    this.nowMs = Date.now();
    this.endedAt = new Date(this.nowMs);
    this.trackingState = 'finished';

    if (this.routePoints.length === 0) {
      this.statusMessage = 'Tracking stopped before a GPS point was recorded.';
      this.errorMessage = 'No route was captured. Please try again in an area with better GPS signal.';
      return;
    }

    if (this.distanceMeters <= 0 || this.elapsedSeconds <= 0) {
      this.statusMessage = 'Tracking stopped.';
      this.errorMessage = 'Not enough movement was recorded to log this workout.';
      return;
    }

    this.refreshActivityDetection();
    this.session = this.buildCompletedSession();
    this.statusMessage = `${this.detectedActivityLabel} route captured. Review the map and log it when you are ready.`;
    this.errorMessage = '';
  }

  resetRun(): void {
    this.stopTrackingWatch();
    this.stopClock();
    this.trackingState = 'idle';
    this.statusMessage = 'Start tracking and the app will record your route locally with GPS.';
    this.errorMessage = '';
    this.routePoints = [];
    this.distanceMeters = 0;
    this.startedAt = null;
    this.endedAt = null;
    this.nowMs = Date.now();
    this.detectedActivityType = 'running';
    this.activityDetection = this.createDefaultActivityDetection();
    this.lastAcceptedPoint = null;
    this.session = this.createEmptySession();
    this.refreshMapRender();
  }

  async logWorkout(): Promise<void> {
    if (!this.canLogWorkout || this.isSavingWorkout) {
      return;
    }

    const trainerNotes = await this.promptForTrainerNotes(
      this.session.trainer_notes ?? this.session.notes ?? ''
    );
    if (trainerNotes === null) {
      return;
    }

    const sessionToSave = this.workoutSessionFormatter.applyTrainerNotes(
      this.session,
      trainerNotes,
      true
    );
    this.session = sessionToSave;

    this.isSavingWorkout = true;
    this.errorMessage = '';

    try {
      const saveResult = await this.workoutLogService.saveCompletedWorkout(sessionToSave);
      this.session = saveResult.savedSession;
      if (saveResult.streakUpdate.kind !== 'unchanged') {
        await this.showStreakUpdateAlert(saveResult.streakUpdate);
      }
      if (saveResult.scoreUpdate) {
        await this.showScoreUpdateAlert(saveResult.scoreUpdate);
      }
      await this.router.navigate(['/workout-summary'], {
        state: {
          summary: saveResult.savedSession,
          loggedAt: saveResult.loggedAt.toISOString(),
          backHref: '/map-tracking-logger',
        },
      });
    } catch (error) {
      console.error('[MapTrackingLoggerPage] Failed to save tracked run:', error);
      this.errorMessage = 'The tracked workout could not be saved. Please try again.';
    } finally {
      this.isSavingWorkout = false;
    }
  }

  private handlePosition(position: GeolocationPosition): void {
    this.nowMs = Date.now();

    const accuracyMeters = Number(position.coords.accuracy ?? 0);
    if (Number.isFinite(accuracyMeters) && accuracyMeters > this.maxAcceptedAccuracyMeters) {
      this.statusMessage = 'GPS signal is weak. Keep the app open while it sharpens your route.';
      return;
    }

    const nextPoint: TrackedPosition = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracyMeters: Number.isFinite(accuracyMeters) ? accuracyMeters : 0,
      timestampMs: Number(position.timestamp || Date.now()),
    };

    if (!Number.isFinite(nextPoint.lat) || !Number.isFinite(nextPoint.lng)) {
      return;
    }

    if (!this.lastAcceptedPoint) {
      this.routePoints = [...this.routePoints, nextPoint];
      this.lastAcceptedPoint = nextPoint;
      this.trackingState = 'running';
      this.statusMessage = 'GPS locked. Your route is now being tracked.';
      this.refreshActivityDetection();
      this.refreshMapRender();
      return;
    }

    const secondsSinceLastPoint = Math.max(
      0,
      (nextPoint.timestampMs - this.lastAcceptedPoint.timestampMs) / 1000
    );
    const segmentDistanceMeters = this.calculateDistanceMeters(this.lastAcceptedPoint, nextPoint);

    if (segmentDistanceMeters < this.minimumMovementMeters) {
      return;
    }

    if (
      secondsSinceLastPoint > 0 &&
      (segmentDistanceMeters / secondsSinceLastPoint) > this.maxAcceptedSpeedMetersPerSecond
    ) {
      return;
    }

    this.distanceMeters += segmentDistanceMeters;
    this.routePoints = [...this.routePoints, nextPoint];
    this.lastAcceptedPoint = nextPoint;
    this.trackingState = 'running';
    this.refreshActivityDetection();
    this.statusMessage = this.hasReliableActivityDetection
      ? `Tracking your route live. Auto-detected: ${this.detectedActivityLabel}.`
      : 'Tracking your route live.';
    this.refreshMapRender();
  }

  private handleGeolocationError(error: GeolocationPositionError): void {
    console.error('[MapTrackingLoggerPage] Geolocation error:', error);

    this.stopTrackingWatch();
    this.stopClock();
    this.nowMs = Date.now();

    if (this.routePoints.length > 0 && this.startedAt) {
      this.endedAt = new Date(this.nowMs);
      this.trackingState = 'finished';
      if (this.distanceMeters > 0 && this.elapsedSeconds > 0) {
        this.refreshActivityDetection();
        this.session = this.buildCompletedSession();
      }
    } else {
      this.startedAt = null;
      this.endedAt = null;
      this.trackingState = 'idle';
    }

    if (error.code === error.PERMISSION_DENIED) {
      this.errorMessage = 'Location access was denied. Enable location permissions to track your workout.';
    } else if (error.code === error.TIMEOUT) {
      this.errorMessage = 'GPS is taking too long to respond. Try moving to a more open area.';
    } else {
      this.errorMessage = 'Location tracking failed. Please try again.';
    }

    this.statusMessage = 'GPS tracking needs a stronger signal before the workout can continue.';
  }

  private startClock(): void {
    this.stopClock();
    this.clockTimerId = window.setInterval(() => {
      this.nowMs = Date.now();
    }, 1000);
  }

  private stopClock(): void {
    if (this.clockTimerId !== null) {
      window.clearInterval(this.clockTimerId);
      this.clockTimerId = null;
    }
  }

  private stopTrackingWatch(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  private buildCompletedSession(): WorkoutSessionPerformance {
    const elapsedMinutes = this.elapsedSeconds / 60;
    const estimatedCalories = this.displayCalories;
    const cardioRow = this.buildCardioRow(estimatedCalories, elapsedMinutes);
    return this.workoutSessionFormatter.normalizeSession({
      date: new Date().toISOString().slice(0, 10),
      cardioTrainingRow: [cardioRow],
      estimated_calories: estimatedCalories,
      sessionType: 'map_tracking',
      trainer_notes: '',
      notes: '',
      isComplete: false,
    }, {
      defaultDate: new Date().toISOString().slice(0, 10),
      isComplete: false,
      sessionType: 'map_tracking',
    });
  }

  private buildCardioRow(
    estimatedCalories: number,
    elapsedMinutes: number
  ): CardioTrainingRow {
    const routeBounds = this.computeRouteBounds(this.routePoints);
    const averagePaceMinutesPerKm = this.distanceMeters > 0
      ? elapsedMinutes / (this.distanceMeters / 1000)
      : 0;
    const averagePaceMinutesPerMile = this.distanceMeters > 0
      ? elapsedMinutes / (this.distanceMeters / 1609.344)
      : 0;

    return {
      Training_Type: 'Cardio',
      estimated_calories: estimatedCalories,
      cardio_type: this.detectedActivityType,
      exercise_type: this.detectedActivityType,
      display_distance: this.formatDistanceText(this.distanceMeters),
      distance_meters: Math.round(this.distanceMeters),
      display_time: this.formatDuration(this.elapsedSeconds),
      time_minutes: Math.round(elapsedMinutes * 100) / 100,
      activity_source: 'map_tracking',
      started_at: this.startedAt?.toISOString(),
      ended_at: this.endedAt?.toISOString(),
      average_pace_minutes_per_km: Math.round(averagePaceMinutesPerKm * 100) / 100,
      average_pace_minutes_per_mile: Math.round(averagePaceMinutesPerMile * 100) / 100,
      route_points: this.routePoints.map((point) => this.toStoredRoutePoint(point)),
      route_bounds: routeBounds ?? undefined,
    };
  }

  private createEmptySession(): WorkoutSessionPerformance {
    return this.workoutSessionFormatter.createEmptySession();
  }

  private async promptForTrainerNotes(initialValue: string): Promise<string | null> {
    return new Promise(async (resolve) => {
      const alert = await this.alertController.create({
        mode: 'ios',
        header: 'Trainer Notes',
        message: 'Add any notes for your trainer before this workout is saved.',
        inputs: [
          {
            name: 'trainerNotes',
            type: 'textarea',
            value: initialValue,
            placeholder: 'How did the workout feel? Anything your trainer should know?',
          },
        ],
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel',
            handler: () => resolve(null),
          },
          {
            text: 'Continue',
            handler: (data) => {
              resolve(String(data?.trainerNotes ?? '').trim());
            },
          },
        ],
        translucent: true,
      });

      await alert.present();
    });
  }

  private async loadUserWeightKg(): Promise<void> {
    const userId = this.auth.currentUser?.uid;
    if (!userId) {
      return;
    }

    try {
      const [statsSnap, userSnap] = await Promise.all([
        getDoc(doc(this.firestore, 'userStats', userId)),
        getDoc(doc(this.firestore, 'users', userId)),
      ]);
      const statsData = statsSnap.exists()
        ? statsSnap.data() as Record<string, unknown>
        : {};
      const userData = userSnap.exists()
        ? userSnap.data() as Record<string, unknown>
        : {};
      const weight = this.toPositiveNumber(
        statsData['weightKg'] ??
        statsData['weight_kg'] ??
        statsData['weight'] ??
        userData['weightKg'] ??
        userData['weight_kg'] ??
        userData['weight']
      );

      if (typeof weight === 'number') {
        this.userWeightKg = weight;
      }
    } catch (error) {
      console.error('[MapTrackingLoggerPage] Failed to load user weight:', error);
    }
  }

  private createDefaultActivityDetection(): ActivityDetectionResult {
    return {
      exerciseType: 'running',
      averageSpeedMetersPerSecond: 0,
      gpsSmoothness: 0,
      bikingConfidence: 0,
    };
  }

  private refreshActivityDetection(): void {
    const nextDetection = this.detectActivityType(this.routePoints);
    this.activityDetection = nextDetection;
    this.detectedActivityType = nextDetection.exerciseType;
  }

  private detectActivityType(points: TrackedPosition[]): ActivityDetectionResult {
    const segments = this.buildRouteSegments(points);
    const totalDistanceMeters = segments.reduce((sum, segment) => sum + segment.distanceMeters, 0);
    const totalDurationSeconds = segments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
    const averageSpeedMetersPerSecond = totalDurationSeconds > 0
      ? totalDistanceMeters / totalDurationSeconds
      : 0;
    const gpsSmoothness = this.calculateGpsSmoothness(points);

    if (
      segments.length < 2 ||
      totalDistanceMeters < this.minimumDetectionDistanceMeters ||
      totalDurationSeconds < this.minimumDetectionDurationSeconds
    ) {
      return {
        exerciseType: 'running',
        averageSpeedMetersPerSecond,
        gpsSmoothness,
        bikingConfidence: 0,
      };
    }

    const upperQuartileSpeed = this.calculatePercentile(
      segments.map((segment) => segment.speedMetersPerSecond),
      0.75
    );
    const speedScore = this.normalizeScore(averageSpeedMetersPerSecond, 4.2, 6);
    const surgeScore = this.normalizeScore(upperQuartileSpeed, 5, 8);
    const smoothnessScore = this.normalizeScore(gpsSmoothness, 0.86, 0.97);
    const bikingConfidence = this.clamp(
      (speedScore * 0.55) + (surgeScore * 0.2) + (smoothnessScore * 0.25),
      0,
      1
    );

    return {
      exerciseType: bikingConfidence >= 0.56 ? 'biking' : 'running',
      averageSpeedMetersPerSecond,
      gpsSmoothness,
      bikingConfidence,
    };
  }

  private buildRouteSegments(points: TrackedPosition[]): RouteSegment[] {
    const segments: RouteSegment[] = [];

    for (let index = 1; index < points.length; index += 1) {
      const previousPoint = points[index - 1];
      const currentPoint = points[index];
      const durationSeconds = Math.max(
        0,
        (currentPoint.timestampMs - previousPoint.timestampMs) / 1000
      );
      const distanceMeters = this.calculateDistanceMeters(previousPoint, currentPoint);

      if (durationSeconds <= 0 || distanceMeters < this.minimumMovementMeters) {
        continue;
      }

      segments.push({
        distanceMeters,
        durationSeconds,
        speedMetersPerSecond: distanceMeters / durationSeconds,
      });
    }

    return segments;
  }

  private calculateGpsSmoothness(points: TrackedPosition[]): number {
    if (points.length < 3) {
      return 0;
    }

    let weightedScore = 0;
    let totalWeight = 0;

    for (let index = 2; index < points.length; index += 1) {
      const firstPoint = points[index - 2];
      const middlePoint = points[index - 1];
      const lastPoint = points[index];
      const firstSegmentDistance = this.calculateDistanceMeters(firstPoint, middlePoint);
      const secondSegmentDistance = this.calculateDistanceMeters(middlePoint, lastPoint);
      const pathDistance = firstSegmentDistance + secondSegmentDistance;

      if (
        firstSegmentDistance < this.minimumMovementMeters ||
        secondSegmentDistance < this.minimumMovementMeters ||
        pathDistance <= 0
      ) {
        continue;
      }

      const directDistance = this.calculateDistanceMeters(firstPoint, lastPoint);
      const straightnessScore = this.clamp(directDistance / pathDistance, 0, 1);
      const firstBearing = this.calculateBearingDegrees(firstPoint, middlePoint);
      const secondBearing = this.calculateBearingDegrees(middlePoint, lastPoint);
      const headingDelta = this.calculateAngularDifferenceDegrees(firstBearing, secondBearing);
      const headingSmoothness = 1 - this.normalizeScore(headingDelta, 18, 80);
      const averageAccuracyMeters = (
        firstPoint.accuracyMeters +
        middlePoint.accuracyMeters +
        lastPoint.accuracyMeters
      ) / 3;
      const accuracyPenalty = this.normalizeScore(averageAccuracyMeters, 18, 45) * 0.2;
      const sampleScore = this.clamp(
        (straightnessScore * 0.72) + (headingSmoothness * 0.28) - accuracyPenalty,
        0,
        1
      );

      weightedScore += sampleScore * pathDistance;
      totalWeight += pathDistance;
    }

    return totalWeight > 0 ? weightedScore / totalWeight : 0;
  }

  private estimateCalories(distanceMeters: number): number {
    if (this.detectedActivityType === 'biking') {
      return this.estimateBikingCalories();
    }

    const distanceKm = Math.max(0, distanceMeters) / 1000;
    const estimated = distanceKm * this.userWeightKg * 1.036;
    return Math.max(0, Math.round(estimated));
  }

  private estimateBikingCalories(): number {
    if (this.elapsedSeconds <= 0) {
      return 0;
    }

    const averageSpeedMetersPerSecond = this.activityDetection.averageSpeedMetersPerSecond > 0
      ? this.activityDetection.averageSpeedMetersPerSecond
      : this.distanceMeters / this.elapsedSeconds;
    const averageSpeedMph = averageSpeedMetersPerSecond * 2.2369362920544;
    const met = averageSpeedMph >= 20
      ? 15.8
      : averageSpeedMph >= 16
        ? 12
        : averageSpeedMph >= 14
          ? 10
          : averageSpeedMph >= 12
            ? 8
            : averageSpeedMph >= 10
              ? 6.8
              : 4;
    const durationMinutes = this.elapsedSeconds / 60;
    const estimated = (met * 3.5 * this.userWeightKg / 200) * durationMinutes;
    return Math.max(0, Math.round(estimated));
  }

  private toStoredRoutePoint(point: TrackedPosition): CardioRoutePoint {
    return {
      lat: Math.round(point.lat * 1_000_000) / 1_000_000,
      lng: Math.round(point.lng * 1_000_000) / 1_000_000,
      recorded_at: new Date(point.timestampMs).toISOString(),
      accuracy_meters: Math.round(point.accuracyMeters * 10) / 10,
    };
  }

  private computeRouteBounds(points: TrackedPosition[]): CardioRouteBounds | null {
    if (points.length === 0) {
      return null;
    }

    const lats = points.map((point) => point.lat);
    const lngs = points.map((point) => point.lng);

    return {
      north: Math.max(...lats),
      south: Math.min(...lats),
      east: Math.max(...lngs),
      west: Math.min(...lngs),
    };
  }

  private refreshMapRender(): void {
    if (this.routePoints.length === 0) {
      this.mapTiles = [];
      this.routePolylinePoints = '';
      this.markerLeftPercent = 50;
      this.markerTopPercent = 50;
      return;
    }

    const viewport = this.buildViewport(this.routePoints);
    const pointPositions = this.routePoints.map((point) => {
      const projected = this.projectLatLng(point.lat, point.lng, viewport.zoom);
      return {
        x: projected.x - viewport.topLeftX,
        y: projected.y - viewport.topLeftY,
      };
    });

    this.routePolylinePoints = pointPositions
      .map((point) => `${Math.round(point.x * 10) / 10},${Math.round(point.y * 10) / 10}`)
      .join(' ');

    const marker = pointPositions[pointPositions.length - 1];
    this.markerLeftPercent = (marker.x / this.mapWidth) * 100;
    this.markerTopPercent = (marker.y / this.mapHeight) * 100;
    this.mapTiles = this.buildTiles(viewport);
  }

  private buildViewport(points: TrackedPosition[]): MapViewport {
    if (points.length === 1) {
      const projected = this.projectLatLng(points[0].lat, points[0].lng, 16);
      return {
        zoom: 16,
        topLeftX: projected.x - (this.mapWidth / 2),
        topLeftY: projected.y - (this.mapHeight / 2),
      };
    }

    let selectedZoom = 16;
    for (let zoom = 17; zoom >= 2; zoom -= 1) {
      const projectedPoints = points.map((point) => this.projectLatLng(point.lat, point.lng, zoom));
      const xs = projectedPoints.map((point) => point.x);
      const ys = projectedPoints.map((point) => point.y);
      const width = Math.max(...xs) - Math.min(...xs);
      const height = Math.max(...ys) - Math.min(...ys);

      if (
        width <= (this.mapWidth - (this.mapPadding * 2)) &&
        height <= (this.mapHeight - (this.mapPadding * 2))
      ) {
        selectedZoom = zoom;
        break;
      }
    }

    const projectedPoints = points.map((point) => this.projectLatLng(point.lat, point.lng, selectedZoom));
    const xs = projectedPoints.map((point) => point.x);
    const ys = projectedPoints.map((point) => point.y);
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;

    return {
      zoom: selectedZoom,
      topLeftX: centerX - (this.mapWidth / 2),
      topLeftY: centerY - (this.mapHeight / 2),
    };
  }

  private buildTiles(viewport: MapViewport): MapTile[] {
    const maxTileIndex = Math.pow(2, viewport.zoom) - 1;
    const startTileX = Math.floor(viewport.topLeftX / this.tileSize);
    const endTileX = Math.floor((viewport.topLeftX + this.mapWidth) / this.tileSize);
    const startTileY = Math.floor(viewport.topLeftY / this.tileSize);
    const endTileY = Math.floor((viewport.topLeftY + this.mapHeight) / this.tileSize);
    const sizePercentX = (this.tileSize / this.mapWidth) * 100;
    const sizePercentY = (this.tileSize / this.mapHeight) * 100;

    const tiles: MapTile[] = [];

    for (let tileX = startTileX; tileX <= endTileX; tileX += 1) {
      for (let tileY = startTileY; tileY <= endTileY; tileY += 1) {
        if (tileY < 0 || tileY > maxTileIndex) {
          continue;
        }

        const wrappedTileX = ((tileX % (maxTileIndex + 1)) + (maxTileIndex + 1)) % (maxTileIndex + 1);
        tiles.push({
          key: `${viewport.zoom}-${wrappedTileX}-${tileY}`,
          url: `https://tile.openstreetmap.org/${viewport.zoom}/${wrappedTileX}/${tileY}.png`,
          leftPercent: ((tileX * this.tileSize) - viewport.topLeftX) / this.mapWidth * 100,
          topPercent: ((tileY * this.tileSize) - viewport.topLeftY) / this.mapHeight * 100,
          sizePercentX,
          sizePercentY,
        });
      }
    }

    return tiles;
  }

  private projectLatLng(lat: number, lng: number, zoom: number): { x: number; y: number } {
    const boundedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const scale = this.tileSize * Math.pow(2, zoom);
    const x = ((lng + 180) / 360) * scale;
    const sinLat = Math.sin((boundedLat * Math.PI) / 180);
    const y = (
      0.5 -
      (Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI))
    ) * scale;

    return { x, y };
  }

  private calculateDistanceMeters(from: TrackedPosition, to: TrackedPosition): number {
    const earthRadiusMeters = 6_371_000;
    const lat1 = (from.lat * Math.PI) / 180;
    const lat2 = (to.lat * Math.PI) / 180;
    const deltaLat = ((to.lat - from.lat) * Math.PI) / 180;
    const deltaLng = ((to.lng - from.lng) * Math.PI) / 180;

    const a =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) *
      Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return earthRadiusMeters * c;
  }

  private calculateBearingDegrees(from: TrackedPosition, to: TrackedPosition): number {
    const fromLat = (from.lat * Math.PI) / 180;
    const toLat = (to.lat * Math.PI) / 180;
    const deltaLng = ((to.lng - from.lng) * Math.PI) / 180;
    const y = Math.sin(deltaLng) * Math.cos(toLat);
    const x = (
      Math.cos(fromLat) * Math.sin(toLat) -
      Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLng)
    );
    const bearingDegrees = (Math.atan2(y, x) * 180) / Math.PI;
    return (bearingDegrees + 360) % 360;
  }

  private calculateAngularDifferenceDegrees(first: number, second: number): number {
    const difference = Math.abs(first - second) % 360;
    return difference > 180 ? 360 - difference : difference;
  }

  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) {
      return 0;
    }

    const sorted = [...values].sort((left, right) => left - right);
    const boundedPercentile = this.clamp(percentile, 0, 1);
    const position = (sorted.length - 1) * boundedPercentile;
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.ceil(position);

    if (lowerIndex === upperIndex) {
      return sorted[lowerIndex];
    }

    const weight = position - lowerIndex;
    return sorted[lowerIndex] + ((sorted[upperIndex] - sorted[lowerIndex]) * weight);
  }

  private normalizeScore(value: number, floor: number, ceiling: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    if (ceiling <= floor) {
      return value >= ceiling ? 1 : 0;
    }

    return this.clamp((value - floor) / (ceiling - floor), 0, 1);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  private formatDistanceText(distanceMeters: number): string {
    if (distanceMeters <= 0) {
      return '0.00 mi';
    }

    const miles = distanceMeters / 1609.344;
    return `${miles.toFixed(2)} mi`;
  }

  private formatDuration(totalSeconds: number): string {
    const safeSeconds = Math.max(0, Math.round(totalSeconds));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const seconds = safeSeconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  private formatPace(secondsPerUnit: number): string {
    if (!Number.isFinite(secondsPerUnit) || secondsPerUnit <= 0) {
      return '--';
    }

    const roundedSeconds = Math.round(secondsPerUnit);
    const minutes = Math.floor(roundedSeconds / 60);
    const seconds = roundedSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  private formatClockTime(value: Date): string {
    return value.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  private toPositiveNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  private roundToTwoDecimals(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  private formatScoreValue(value: number): string {
    return String(this.roundToTwoDecimals(value));
  }

  private formatSignedScore(value: number): string {
    const rounded = this.roundToTwoDecimals(value);
    const absoluteValue = this.formatScoreValue(Math.abs(rounded));
    return `${rounded < 0 ? '-' : '+'} ${absoluteValue}`;
  }

  private buildScoreUpdateMessage(scoreUpdate: UpdateScoreResult): string {
    const lines = scoreUpdate.exerciseScoreDeltas.map((entry) => (
      `${this.formatExerciseName(entry.exerciseType)}: ${this.formatSignedScore(entry.addedScore)}`
    ));

    lines.push(`Total Added: ${this.formatSignedScore(scoreUpdate.addedTotalScore)}`);
    lines.push('');
    lines.push(`New Total: ${this.formatScoreValue(scoreUpdate.currentTotalScore)}`);

    return lines.join('\n');
  }

  private formatExerciseName(value: string): string {
    return String(value ?? '')
      .split('_')
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ');
  }

  private async showScoreUpdateAlert(scoreUpdate: UpdateScoreResult): Promise<void> {
    const alert = await this.alertController.create({
      mode: 'ios',
      header: 'Score Updated',
      cssClass: 'score-update-alert',
      message: this.buildScoreUpdateMessage(scoreUpdate),
      buttons: ['OK'],
      translucent: true,
    });

    await alert.present();
  }

  private async showStreakUpdateAlert(streakUpdate: StreakUpdateResult): Promise<void> {
    const { header, message } = this.buildStreakUpdateAlertContent(streakUpdate);
    const alert = await this.alertController.create({
      mode: 'ios',
      header,
      cssClass: 'score-update-alert',
      message,
      buttons: ['OK'],
      translucent: true,
    });

    await alert.present();
  }

  private buildStreakUpdateAlertContent(
    streakUpdate: StreakUpdateResult
  ): { header: string; message: string } {
    const lines = [`Current Streak: ${this.formatStreakDays(streakUpdate.currentStreak)}`];

    if (streakUpdate.maxStreak > 0) {
      lines.push(`Max Streak: ${this.formatStreakDays(streakUpdate.maxStreak)}`);
    }

    if (streakUpdate.maxStreak > streakUpdate.previousMaxStreak) {
      lines.push('', 'New max streak reached.');
    }

    if (streakUpdate.kind === 'restarted') {
      return {
        header: 'Streak Restarted',
        message: ['You are back on track.', ...lines].join('\n'),
      };
    }

    if (streakUpdate.kind === 'extended') {
      return {
        header: 'Streak Updated',
        message: ['Nice work, your streak just grew.', ...lines].join('\n'),
      };
    }

    return {
      header: 'Streak Started',
      message: ['Your workout streak has started.', ...lines].join('\n'),
    };
  }

  private formatStreakDays(value: number): string {
    const safeValue = Math.max(0, Math.floor(Number(value) || 0));
    return `${safeValue} day${safeValue === 1 ? '' : 's'}`;
  }
}
