import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';

@Component({
  selector: 'app-camera',
  templateUrl: './camera.page.html',
  styleUrls: ['./camera.page.scss'],
  standalone: true,
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonButton,
    IonText,
    CommonModule,
  ],
})
export class CameraPage implements AfterViewInit, OnDestroy {
  @ViewChild('cameraVideo', { static: false }) cameraVideo?: ElementRef<HTMLVideoElement>;

  isLoading = false;
  errorMessage = '';
  hasCameraSupport = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  private mediaStream: MediaStream | null = null;

  async ngAfterViewInit(): Promise<void> {
    await this.startCamera();
  }

  async ionViewDidEnter(): Promise<void> {
    if (!this.mediaStream) {
      await this.startCamera();
    }
  }

  ionViewWillLeave(): void {
    this.stopCamera();
  }

  ngOnDestroy(): void {
    this.stopCamera();
  }

  async retryCamera(): Promise<void> {
    this.stopCamera();
    await this.startCamera();
  }

  private async startCamera(): Promise<void> {
    if (!this.hasCameraSupport || this.isLoading || this.mediaStream || !this.cameraVideo) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });

      this.mediaStream = stream;
      const videoElement = this.cameraVideo.nativeElement;
      videoElement.srcObject = stream;
      await videoElement.play();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to access camera.';
      this.errorMessage = `Camera access failed: ${message}`;
      this.stopCamera();
    } finally {
      this.isLoading = false;
    }
  }

  private stopCamera(): void {
    const videoElement = this.cameraVideo?.nativeElement;
    if (videoElement) {
      videoElement.pause();
      videoElement.srcObject = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }
}
