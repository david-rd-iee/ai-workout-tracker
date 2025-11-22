import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, OnInit, Output } from '@angular/core';

import { CommonModule } from '@angular/common';
import { TimePickerModalComponent } from '../time-picker-modal/time-picker-modal.component';
import { IonicModule, ModalController } from '@ionic/angular';
import { addCircleOutline, closeCircleOutline } from 'ionicons/icons';
import { addIcons } from 'ionicons';
import { DayAvailability } from 'src/app/Interfaces/Availability';



@Component({
  selector: 'app-availabilty',
  templateUrl: './availabilty.component.html',
  styleUrls: ['./availabilty.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TimePickerModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class AvailabiltyComponent implements OnInit {
  @Input() availability: DayAvailability[] = [];
  @Output() availabilityChange = new EventEmitter<DayAvailability[]>();
  

  days = [
    { name: 'Sun', fullName: 'Sunday' },
    { name: 'Mon', fullName: 'Monday' },
    { name: 'Tue', fullName: 'Tuesday' },
    { name: 'Wed', fullName: 'Wednesday' },
    { name: 'Thu', fullName: 'Thursday' },
    { name: 'Fri', fullName: 'Friday' },
    { name: 'Sat', fullName: 'Saturday' }
  ];



  ngOnInit() {
    // Initialize availability if not provided
    if (!this.availability || this.availability.length === 0) {
      this.availability = this.days.map(day => ({
        day: day.name,
        available: false,
        timeWindows: [{
          startTime: '09:00 AM',
          endTime: '05:00 PM'
        }]
      }));
      this.availabilityChange.emit(this.availability);
    }
  }

  toggleAvailability(day: DayAvailability) {
    day.available = !day.available;
    this.availabilityChange.emit(this.availability);
  }

  /**
   * Converts a time string (e.g., '09:00 AM') to ISO format for the datetime component
   * @param timeString Time string in 12-hour format
   * @returns ISO formatted time string
   */
  getISOTime(timeString: string): string {
    if (!timeString) return '';
    
    try {
      // For Ionic datetime, we need a full ISO date string
      // We'll use today's date with the time from the input
      
      // Parse the time string (e.g., '09:00 AM')
      const parts = timeString.split(' ');
      const timePart = parts[0];
      const ampm = parts[1];
      
      const timePieces = timePart.split(':');
      let hours = Number(timePieces[0]);
      const minutes = Number(timePieces[1]);
      
      // Convert to 24-hour format
      if (ampm === 'PM' && hours < 12) {
        hours += 12;
      } else if (ampm === 'AM' && hours === 12) {
        hours = 0;
      }
      
      // Create a date string in the format that Ionic datetime expects
      const today = new Date().toISOString().split('T')[0]; // Get today's date part
      const formattedTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
      
      return `${today}T${formattedTime}`;
    } catch (error) {
      console.error('Error parsing time string:', error);
      return new Date().toISOString(); // Return current time as fallback
    }
  }

  /**
   * Formats an ISO time string to 12-hour format (e.g., '09:00 AM')
   * @param isoString ISO time string
   * @returns Formatted time string
   */
  formatTimeFrom(isoString: string): string {
    if (!isoString) return '';
    
    try {
      // Extract just the time part from the ISO string
      const timeMatch = isoString.match(/T(\d{2}):(\d{2})/);
      if (!timeMatch) {
        throw new Error('Invalid ISO time format');
      }
      
      let hours = parseInt(timeMatch[1], 10);
      const minutes = timeMatch[2];
      const ampm = hours >= 12 ? 'PM' : 'AM';
      
      // Convert to 12-hour format with hours 1-12
      if (hours === 0) {
        hours = 12; // 00:00 (midnight) becomes 12 AM
      } else if (hours > 12) {
        hours = hours - 12; // PM hours (13-23) become 1-11 PM
      }
      // hours 1-11 AM stay as is
      
      return `${hours.toString().padStart(2, '0')}:${minutes} ${ampm}`;
    } catch (error) {
      console.error('Error formatting ISO string:', error);
      return '';
    }
  }


  // These methods were removed as they're no longer needed with the new modal approach
  
  formatDisplayTime(timeString: string | null | undefined): string {
    if (!timeString) {
      return 'Select Time';
    }
    
    return timeString;
  }
  
  // Track the current day being edited
  currentDay: DayAvailability | null = null;

  constructor(private modalCtrl: ModalController) {
    console.log('AvailabiltyComponent constructor called');
    // Register Ionicons
    addIcons({ 
      'close-circle-outline': closeCircleOutline,
      'add-circle-outline': addCircleOutline
    });
  }

  async openStartTimeModal(_modal: any, day: DayAvailability, index: number) {
    console.log('openStartTimeModal called for day:', day);
    try {
      // Store the current day being edited
      this.currentDay = day;
      
      // Create modal using the proper component
      const modal = await this.modalCtrl.create({
        component: TimePickerModalComponent,
        componentProps: {
          value: this.getISOTime(day.timeWindows[index].startTime)
        },
        backdropDismiss: false
      });
      
      // Handle the modal result
      modal.onDidDismiss().then((result) => {
        console.log('Modal dismissed with result:', result);
        if (result && result.data && result.data.value) {
          day.timeWindows[index].startTime = this.formatTimeFrom(result.data.value);
          this.availabilityChange.emit(this.availability);
          console.log('Updated start time:', day.timeWindows[index].startTime);
        }
      });
      
      await modal.present();
    } catch (error) {
      console.error('Error in openStartTimeModal:', error);
    }
  }
  
  async openEndTimeModal(_modal: any, day: DayAvailability, index: number) {
    console.log('openEndTimeModal called for day:', day);
    try {
      // Store the current day being edited
      this.currentDay = day;
      
      // Create modal using the proper component
      const modal = await this.modalCtrl.create({
        component: TimePickerModalComponent,
        componentProps: {
          value: this.getISOTime(day.timeWindows[index].endTime)
        },
        backdropDismiss: false
      });
      
      // Handle the modal result
      modal.onDidDismiss().then((result) => {
        console.log('Modal dismissed with result:', result);
        if (result && result.data && result.data.value) {
          day.timeWindows[index].endTime = this.formatTimeFrom(result.data.value);
          this.availabilityChange.emit(this.availability);
          console.log('Updated end time:', day.timeWindows[index].endTime);
        }
      });
      
      await modal.present();
    } catch (error) {
      console.error('Error in openEndTimeModal:', error);
    }
  }
  
  clearTime(day: DayAvailability, index: number, event: Event) {
    event.stopPropagation();
    day.timeWindows.splice(index, 1);
    this.availabilityChange.emit(this.availability);
  }

  addTimeWindow(day: DayAvailability) {
    day.timeWindows.push({ startTime: '09:00 AM', endTime: '05:00 PM' });
    this.availabilityChange.emit(this.availability);
  }

  removeTimeWindow(day: DayAvailability, index: number) {
    // Only remove if there's more than one time window
    if (day.timeWindows.length > 1) {
      day.timeWindows.splice(index, 1);
      this.availabilityChange.emit(this.availability);
    }
  }

}
