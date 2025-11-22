import { Component, Input, OnInit, CUSTOM_ELEMENTS_SCHEMA, AfterViewInit, NgZone, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalController, Platform } from '@ionic/angular';
import { IonDatetime, IonHeader, IonContent, IonTitle, IonToolbar, IonButton, IonButtons } from '@ionic/angular/standalone';

@Component({
  selector: 'app-time-picker-modal',
  templateUrl: './time-picker-modal.component.html',
  styleUrls: ['./time-picker-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonDatetime, 
    IonHeader, 
    IonContent,
    IonTitle, 
    IonToolbar,
    IonButton,
    IonButtons
  ],
  providers: [
    ModalController,
    Platform
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class TimePickerModalComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() value: string = '';
  
  // Hour values for the time picker (1-12)
  // Note: In Ionic's datetime component with hourCycle="h12", hour 0 represents 12 AM and hour 12 represents 12 PM
  hourValues = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0];
  
  // Track if this is the first time the modal is opened
  private static isInitialized = false;
  private timeoutId: any;
  private isIOS: boolean = false;
  
  constructor(
    private modalCtrl: ModalController,
    private platform: Platform,
    private zone: NgZone
  ) {
    console.log('TimePickerModalComponent constructor called');
    this.isIOS = this.platform.is('ios');
    console.log('Platform is iOS:', this.isIOS);
  }

  ngOnInit() {
    console.log('TimePickerModalComponent initialized with value:', this.value);
    
    // Ensure we have a valid time value
    if (!this.value) {
      // Default to current time if no value provided
      const now = new Date();
      // Format as ISO string but ensure we use 1-12 hour format for display
      this.value = now.toISOString();
    }
    
    // Optimize first-time loading
    if (!TimePickerModalComponent.isInitialized) {
      console.log('First load of time picker, optimizing initialization');
      TimePickerModalComponent.isInitialized = true;
      
      // Preload any necessary resources
      setTimeout(() => {
        console.log('Time picker initialization complete');
      }, 10);
    }
  }
  
  ngAfterViewInit() {
    // For iOS, we need to ensure the datetime is properly initialized
    if (this.isIOS) {
      // Use a short timeout to ensure the component is fully rendered
      this.timeoutId = setTimeout(() => {
        this.zone.run(() => {
          console.log('Ensuring datetime is properly initialized on iOS');
          // Force a refresh of the component
          const datetimeEl = document.querySelector('ion-datetime');
          if (datetimeEl) {
            console.log('Found datetime element, refreshing');
            // Force a refresh by triggering a layout
            (datetimeEl as any).forceUpdate?.();
          }
        });
      }, 100);
    }
  }
  
  ngOnDestroy() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
  }
  
  onTimeChange(event: any) {
    console.log('Time changed event:', event);
    const value = event.detail.value;
    console.log('Dismissing modal with value:', value);
    
    // Immediately dismiss on iOS to improve responsiveness
    this.zone.run(() => {
      this.modalCtrl.dismiss({
        value: value
      });
    });
  }

  cancel() {
    console.log('Cancel button clicked');
    this.modalCtrl.dismiss();
  }
}
