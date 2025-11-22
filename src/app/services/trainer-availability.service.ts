import { Injectable, signal, computed, Signal } from '@angular/core';
import { Firestore, collection, doc, getDoc, setDoc, updateDoc } from '@angular/fire/firestore';
import { onSnapshot } from 'firebase/firestore';
import { TimeSlot } from '../Interfaces/Calendar';

@Injectable({
  providedIn: 'root'
})
export class TrainerAvailabilityService {
  // Signals for reactive state management
  private availableTimeSlots = signal<TimeSlot[]>([]);
  
  constructor(private firestore: Firestore) { }

  /**
   * Get a trainer's availability for a specific date
   * @param trainerId The ID of the trainer
   * @param date The date to get availability for (YYYY-MM-DD)
   * @returns A signal containing the available time slots
   */
  getTrainerAvailability(trainerId: string, date: string): Signal<TimeSlot[]> {
    
    // Clear current time slots while loading
    this.availableTimeSlots.set([]);
    
    // Get the day of the week for the selected date
    const dateObj = new Date(date);
    const dayOfWeek = dateObj.toLocaleString('en-US', { weekday: 'long' });
    
    // Check both possible document paths for trainer availability
    const trainerDocRef = doc(this.firestore, `trainers/${trainerId}`);
    const trainerAvailabilityRef = doc(this.firestore, `trainerAvailability/${trainerId}`);
    

    // Check both paths for availability data
    Promise.all([
      getDoc(trainerDocRef),
      getDoc(trainerAvailabilityRef)
    ]).then(([trainerSnap, availabilitySnap]) => {
      
      if (trainerSnap.exists()) {
        const trainerData = trainerSnap.data();
        
        // Check if availability array exists in the trainer document
        if (trainerData['availability'] && Array.isArray(trainerData['availability'])) {
          this.processAvailabilityFromArray(trainerId, date, trainerData['availability'], dayOfWeek);
          return; // Exit early if we found availability in the trainer document
        } else {
          console.log('DEBUG: No availability array found in trainers collection');
        }
      } else {
        console.log('DEBUG: No trainer document found in trainers collection');
      }
      
      // If we get here, we didn't find availability in the trainer document, so check the availability document
      if (availabilitySnap.exists()) {
        const availabilityData = availabilitySnap.data();
        
        if (availabilityData['availability'] && Array.isArray(availabilityData['availability'])) {
          this.processAvailabilityFromArray(trainerId, date, availabilityData['availability'], dayOfWeek);
        } else {
          this.availableTimeSlots.set([]);
        }
      } else {
        console.log('DEBUG: No availability document found in trainerAvailability collection');
        this.availableTimeSlots.set([]);
      }
    }).catch(error => {
      console.error('DEBUG: Error getting trainer data:', error);
      this.availableTimeSlots.set([]);
    });
    
    // Set up real-time listeners for changes
    const unsubscribeTrainer = onSnapshot(trainerDocRef, (snapshot) => {
      console.log(`DEBUG: Real-time update from trainers/${trainerId}: ${snapshot.exists() ? 'Document exists' : 'Document does not exist'}`);
      
      if (snapshot.exists()) {
        const trainerData = snapshot.data();
        if (trainerData['availability'] && Array.isArray(trainerData['availability'])) {
          this.processAvailabilityFromArray(trainerId, date, trainerData['availability'], dayOfWeek);
        }
      }
    }, (error) => {
      console.error('DEBUG: Error in trainer document listener:', error);
    });
    
    const unsubscribeAvailability = onSnapshot(trainerAvailabilityRef, (snapshot) => {
      console.log(`DEBUG: Real-time update from trainerAvailability/${trainerId}: ${snapshot.exists() ? 'Document exists' : 'Document does not exist'}`);
      
      if (snapshot.exists()) {
        const availabilityData = snapshot.data();
        if (availabilityData['availability'] && Array.isArray(availabilityData['availability'])) {
          this.processAvailabilityFromArray(trainerId, date, availabilityData['availability'], dayOfWeek);
        }
      }
    }, (error) => {
      console.error('DEBUG: Error in availability document listener:', error);
    });
    
    return this.availableTimeSlots;
  }
  
  /**
   * Process availability from an array format and generate available time slots
   * @param trainerId The ID of the trainer
   * @param date The date to get availability for
   * @param availabilityArray The array of availability data
   * @param dayOfWeek The day of the week (e.g., 'Monday')
   */
  private processAvailabilityFromArray(trainerId: string, date: string, availabilityArray: any[], dayOfWeek: string): void {
    
    // Find the availability entry for the current day of week
    const dayEntry = availabilityArray.find(entry => {
      // Try different formats of day name (lowercase, capitalized, etc.)
      const day = entry.day || '';
      const dayMatches = day.toLowerCase() === dayOfWeek.toLowerCase() || 
                        day.toLowerCase() === dayOfWeek.substring(0, 3).toLowerCase();
      
      console.log(`DEBUG: Comparing day entry '${day}' with day of week '${dayOfWeek}': ${dayMatches}`);
      return dayMatches;
    });
    
    if (dayEntry) {
      console.log('DEBUG: Found day entry:', JSON.stringify(dayEntry, null, 2));
      
      // Check if the day is available
      if (dayEntry.available === false) {
        console.log('DEBUG: Day is marked as not available');
        this.availableTimeSlots.set([]);
        return;
      }
      
      // Generate time slots from the availability
      const timeSlots = this.generateTimeSlotsFromArray(dayEntry);
      console.log('DEBUG: Generated time slots:', timeSlots);
      
      if (timeSlots.length === 0) {
        console.log('DEBUG: No time slots were generated from the day entry');
        this.availableTimeSlots.set([]);
        return;
      }
      
      // Check for bookings using the bookedSessions array
      const trainerAvailabilityRef = doc(this.firestore, `trainerAvailability/${trainerId}`);
      
      // Get the trainer availability document
      getDoc(trainerAvailabilityRef).then((trainerAvailabilitySnap) => {
        console.log(`DEBUG: Trainer availability document exists: ${trainerAvailabilitySnap.exists()}`);
        
        let updatedTimeSlots = [...timeSlots];
        
        // Check bookedSessions array
        if (trainerAvailabilitySnap.exists() && trainerAvailabilitySnap.data()['bookedSessions']) {
          const bookedSessions = trainerAvailabilitySnap.data()['bookedSessions'] || [];
          console.log(`DEBUG: Found ${bookedSessions.length} booked sessions in total`);
          
          // Filter for sessions on the selected date that aren't cancelled
          const activeSessions = bookedSessions.filter((session: any) => 
            session.date === date && session.status !== 'cancelled'
          );
          
          console.log(`DEBUG: Found ${activeSessions.length} active sessions for date ${date}`);
          
          // Mark booked slots as unavailable
          if (activeSessions.length > 0) {
            console.log('DEBUG: Active sessions for this date:', JSON.stringify(activeSessions, null, 2));
            
            updatedTimeSlots = updatedTimeSlots.map(slot => {
              // Check if this time slot is booked in any session
              const isBooked = activeSessions.some((session: any) => session.startTime === slot.time);
              if (isBooked) {
                console.log(`DEBUG: Marking time slot ${slot.time} as booked`);
                return { ...slot, booked: true };
              }
              return slot;
            });
            
            console.log('DEBUG: Time slots after checking bookedSessions array:', updatedTimeSlots);
          }
        } else {
          console.log('DEBUG: No bookedSessions array found in trainer availability document');
        }
        
        // Update the available time slots
        console.log(`DEBUG: Setting ${updatedTimeSlots.length} available time slots`);
        this.availableTimeSlots.set(updatedTimeSlots);
      }).catch(error => {
        console.error('Error checking bookings:', error);
        // Still update with available slots even if checking bookings fails
        this.availableTimeSlots.set(timeSlots);
      });
    } else {
      console.log('No availability entry found for this day of week');
      this.availableTimeSlots.set([]);
    }
  }
  
  /**
   * Generate time slots from an availability array entry
   * @param dayEntry The availability entry for a specific day
   * @returns An array of TimeSlot objects
   */
  private generateTimeSlotsFromArray(dayEntry: any): TimeSlot[] {
    const timeSlots: TimeSlot[] = [];
    
    console.log('DEBUG: Generating time slots from day entry:', JSON.stringify(dayEntry, null, 2));
    
    // Check if we have timeWindows array (new format)
    if (dayEntry.timeWindows && Array.isArray(dayEntry.timeWindows)) {
      console.log('DEBUG: Found timeWindows array with', dayEntry.timeWindows.length, 'time blocks');
      
      // Process each time window
      for (const timeWindow of dayEntry.timeWindows) {
        if (timeWindow.startTime && timeWindow.endTime) {
          console.log(`DEBUG: Processing time window: ${timeWindow.startTime} to ${timeWindow.endTime}`);
          
          // Parse the start and end times
          const startTimeParts = this.parseTime(timeWindow.startTime);
          const endTimeParts = this.parseTime(timeWindow.endTime);
          
          console.log('DEBUG: Parsed time parts:', {
            start: timeWindow.startTime,
            startParsed: startTimeParts,
            end: timeWindow.endTime,
            endParsed: endTimeParts
          });
          
          if (startTimeParts && endTimeParts) {
            // Generate 30-minute slots between start and end times
            let currentHour = startTimeParts.hour;
            let currentMinute = startTimeParts.minute;
            const endHour = endTimeParts.hour;
            const endMinute = endTimeParts.minute;
            
            console.log(`DEBUG: Generating slots from ${currentHour}:${currentMinute} to ${endHour}:${endMinute}`);
            
            // Generate time slots in 30-minute increments
            while (
              currentHour < endHour || 
              (currentHour === endHour && currentMinute <= endMinute)
            ) {
              const ampm = currentHour < 12 ? 'AM' : 'PM';
              const hour12 = currentHour % 12 || 12;
              const minuteStr = currentMinute === 0 ? '00' : '30';
              
              const time = `${hour12}:${minuteStr} ${ampm}`;
              console.log(`DEBUG: Generated time slot: ${time}`);
              
              timeSlots.push({
                time,
                available: true,
                booked: false
              });
              
              // Increment by 30 minutes
              currentMinute += 30;
              if (currentMinute >= 60) {
                currentHour += 1;
                currentMinute = 0;
              }
            }
          } else {
            console.log('DEBUG: Failed to parse time strings:', { 
              start: timeWindow.startTime, 
              end: timeWindow.endTime,
              startParsed: startTimeParts,
              endParsed: endTimeParts
            });
          }
        } else {
          console.log(`DEBUG: Invalid time window, missing startTime or endTime:`, timeWindow);
        }
      }
    } 
    // Check if we have times array (legacy format from other components)
    else if (dayEntry.times && Array.isArray(dayEntry.times)) {
      console.log('DEBUG: Found legacy times array with', dayEntry.times.length, 'time blocks');
      
      // Each time entry should have start and end properties
      for (const timeBlock of dayEntry.times) {
        if (timeBlock.start && timeBlock.end) {
          console.log(`DEBUG: Processing legacy time block: ${timeBlock.start} to ${timeBlock.end}`);
          
          // Parse the start and end times
          const startTimeParts = this.parseTime(timeBlock.start);
          const endTimeParts = this.parseTime(timeBlock.end);
          
          console.log('DEBUG: Parsed time parts:', {
            start: timeBlock.start,
            startParsed: startTimeParts,
            end: timeBlock.end,
            endParsed: endTimeParts
          });
          
          if (startTimeParts && endTimeParts) {
            // Generate 30-minute slots between start and end times
            let currentHour = startTimeParts.hour;
            let currentMinute = startTimeParts.minute;
            const endHour = endTimeParts.hour;
            const endMinute = endTimeParts.minute;
            
            console.log(`DEBUG: Generating slots from ${currentHour}:${currentMinute} to ${endHour}:${endMinute}`);
            
            // Generate time slots in 30-minute increments
            while (
              currentHour < endHour || 
              (currentHour === endHour && currentMinute <= endMinute)
            ) {
              const ampm = currentHour < 12 ? 'AM' : 'PM';
              const hour12 = currentHour % 12 || 12;
              const minuteStr = currentMinute === 0 ? '00' : '30';
              
              const time = `${hour12}:${minuteStr} ${ampm}`;
              console.log(`DEBUG: Generated time slot: ${time}`);
              
              timeSlots.push({
                time,
                available: true,
                booked: false
              });
              
              // Increment by 30 minutes
              currentMinute += 30;
              if (currentMinute >= 60) {
                currentHour += 1;
                currentMinute = 0;
              }
            }
          }
        }
      }
    } 
    // Fall back to single time range if no arrays (legacy format)
    else if (dayEntry.startTime && dayEntry.endTime) {
      console.log(`DEBUG: Using legacy single time range: ${dayEntry.startTime} to ${dayEntry.endTime}`);
      
      // Parse the start and end times
      const startTimeParts = this.parseTime(dayEntry.startTime);
      const endTimeParts = this.parseTime(dayEntry.endTime);
      
      console.log('DEBUG: Parsed time parts for single range:', {
        start: dayEntry.startTime,
        startParsed: startTimeParts,
        end: dayEntry.endTime,
        endParsed: endTimeParts
      });
      
      if (startTimeParts && endTimeParts) {
        // Generate 30-minute slots between start and end times
        let currentHour = startTimeParts.hour;
        let currentMinute = startTimeParts.minute;
        const endHour = endTimeParts.hour;
        const endMinute = endTimeParts.minute;
        
        console.log(`DEBUG: Generating slots from ${currentHour}:${currentMinute} to ${endHour}:${endMinute}`);
        
        // Generate time slots in 30-minute increments
        while (
          currentHour < endHour || 
          (currentHour === endHour && currentMinute <= endMinute)
        ) {
          const ampm = currentHour < 12 ? 'AM' : 'PM';
          const hour12 = currentHour % 12 || 12;
          const minuteStr = currentMinute === 0 ? '00' : '30';
          
          const time = `${hour12}:${minuteStr} ${ampm}`;
          console.log(`DEBUG: Generated time slot: ${time}`);
          
          timeSlots.push({
            time,
            available: true,
            booked: false
          });
          
          // Increment by 30 minutes
          currentMinute += 30;
          if (currentMinute >= 60) {
            currentHour += 1;
            currentMinute = 0;
          }
        }
      } else {
        console.log('DEBUG: Failed to parse single time range');
      }
    } else {
      console.log('DEBUG: Day entry has no recognized time format (neither timeWindows, times array, nor startTime/endTime properties)');
    }
    
    return timeSlots;
  }

  /**
   * Save trainer's weekly availability
   * @param trainerId The ID of the trainer
   * @param availabilityData The availability data from the component
   * @param useTrainerAvailabilityCollection If true, save to trainerAvailability collection instead of trainers collection
   */
  saveTrainerWeeklyAvailability(trainerId: string, availabilityData: any[], useTrainerAvailabilityCollection: boolean = false): Promise<void> {
    console.log('DEBUG: Saving trainer availability:', JSON.stringify(availabilityData, null, 2));
    console.log(`DEBUG: Saving to ${useTrainerAvailabilityCollection ? 'trainerAvailability' : 'trainers'} collection`);
    
    // Determine which document to update based on the flag
    const docPath = useTrainerAvailabilityCollection ? `trainerAvailability/${trainerId}` : `trainers/${trainerId}`;
    const docRef = doc(this.firestore, docPath);
    
    // Check if the document exists first
    return getDoc(docRef).then(docSnap => {
      if (docSnap.exists()) {
        console.log(`DEBUG: Document exists at ${docPath}, updating it`);
        return updateDoc(docRef, { availability: availabilityData });
      } else {
        console.log(`DEBUG: Document does not exist at ${docPath}, creating it`);
        return setDoc(docRef, { availability: availabilityData }, { merge: true });
      }
    });
  }
  /**
   * Format date to YYYY-MM-DD
   */
  formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Parse a time string in various formats to extract hour and minute
   * @param timeStr The time string to parse (e.g., '8:00 AM', '14:30', '2:30PM')
   * @returns An object with hour and minute properties, or null if parsing fails
   */
  private parseTime(timeStr: string): { hour: number, minute: number } | null {
    if (!timeStr) {
      console.log('No time string provided');
      return null;
    }
    
    console.log(`Parsing time string: '${timeStr}'`);
    
    // Try format: 'HH:MM AM/PM' with space (e.g., '8:00 AM')
    let match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    
    // If not matched, try format without space (e.g., '8:00AM')
    if (!match) {
      match = timeStr.match(/^(\d{1,2}):(\d{2})(AM|PM)$/i);
    }
    
    // If still not matched, try 24-hour format (e.g., '14:30')
    if (!match) {
      match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
      if (match) {
        const hour = parseInt(match[1], 10);
        const minute = parseInt(match[2], 10);
        return { hour, minute };
      }
    }
    
    // If no match found with any format
    if (!match) {
      return null;
    }
    
    let hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    
    // If we have AM/PM format
    if (match[3]) {
      const ampm = match[3].toUpperCase();
      
      // Convert to 24-hour format
      if (ampm === 'PM' && hour < 12) {
        hour += 12;
      } else if (ampm === 'AM' && hour === 12) {
        hour = 0;
      }
    }
    
    console.log(`Final parsed time: ${hour}:${minute}`);
    return { hour, minute };
  }
}
