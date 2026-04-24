import { Injectable, signal, computed, Signal } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { doc, getDoc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { TimeSlot } from '../Interfaces/Calendar';
import { DayAvailability } from '../Interfaces/Availability';

@Injectable({
  providedIn: 'root'
})
export class TrainerAvailabilityService {
  // Signals for reactive state management
  private availableTimeSlots = signal<TimeSlot[]>([]);
  private trainerProfileUnsubscribe: (() => void) | null = null;
  private trainerAvailabilityUnsubscribe: (() => void) | null = null;
  
  constructor(private firestore: Firestore) { }

  private parseDateInput(date: string): Date | null {
    const normalized = String(date || '').trim();
    if (!normalized) {
      return null;
    }

    const directDateMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (directDateMatch) {
      const year = Number.parseInt(directDateMatch[1], 10);
      const month = Number.parseInt(directDateMatch[2], 10);
      const day = Number.parseInt(directDateMatch[3], 10);
      return new Date(year, month - 1, day);
    }

    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private normalizeAvailabilityEntries(rawAvailability: unknown): any[] {
    if (Array.isArray(rawAvailability)) {
      return rawAvailability;
    }

    if (!rawAvailability || typeof rawAvailability !== 'object') {
      return [];
    }

    return Object.entries(rawAvailability as Record<string, unknown>).map(([day, slots]) => ({
      day,
      available: Array.isArray(slots) ? slots.length > 0 : Boolean(slots),
      timeWindows: Array.isArray(slots)
        ? slots
            .map((slot) => {
              const normalizedSlot = slot as Record<string, unknown>;
              const start = String(
                normalizedSlot['startTime'] || normalizedSlot['start'] || ''
              ).trim();
              const end = String(
                normalizedSlot['endTime'] || normalizedSlot['end'] || ''
              ).trim();
              return start && end ? { startTime: start, endTime: end } : null;
            })
            .filter((slot): slot is { startTime: string; endTime: string } => !!slot)
        : [],
    }));
  }

  private createDefaultWeeklyAvailability(): DayAvailability[] {
    return [
      { day: 'Sun', available: false, timeWindows: [{ startTime: '09:00 AM', endTime: '05:00 PM' }] },
      { day: 'Mon', available: false, timeWindows: [{ startTime: '09:00 AM', endTime: '05:00 PM' }] },
      { day: 'Tue', available: false, timeWindows: [{ startTime: '09:00 AM', endTime: '05:00 PM' }] },
      { day: 'Wed', available: false, timeWindows: [{ startTime: '09:00 AM', endTime: '05:00 PM' }] },
      { day: 'Thu', available: false, timeWindows: [{ startTime: '09:00 AM', endTime: '05:00 PM' }] },
      { day: 'Fri', available: false, timeWindows: [{ startTime: '09:00 AM', endTime: '05:00 PM' }] },
      { day: 'Sat', available: false, timeWindows: [{ startTime: '09:00 AM', endTime: '05:00 PM' }] },
    ];
  }

  async getTrainerWeeklyAvailability(trainerId: string): Promise<DayAvailability[]> {
    const normalizedTrainerId = String(trainerId || '').trim();
    if (!normalizedTrainerId) {
      return this.createDefaultWeeklyAvailability();
    }

    const trainerProfileRef = doc(this.firestore, 'trainers', normalizedTrainerId);
    const trainerAvailabilityRef = doc(this.firestore, `trainerAvailability/${normalizedTrainerId}`);
    const [trainerProfileSnap, trainerAvailabilitySnap] = await Promise.all([
      getDoc(trainerProfileRef),
      getDoc(trainerAvailabilityRef),
    ]);

    const rawAvailability =
      trainerProfileSnap.data()?.['availability'] ??
      trainerAvailabilitySnap.data()?.['availability'] ??
      null;

    const normalizedAvailability = this.normalizeAvailabilityEntries(rawAvailability);
    if (!normalizedAvailability.length) {
      return this.createDefaultWeeklyAvailability();
    }

    const byDay = new Map(
      normalizedAvailability.map((entry) => [String(entry.day || '').trim().toLowerCase(), entry])
    );

    return this.createDefaultWeeklyAvailability().map((defaultDay) => {
      const matched = byDay.get(defaultDay.day.toLowerCase());
      if (!matched) {
        return defaultDay;
      }

      const timeWindows = Array.isArray(matched.timeWindows)
        ? matched.timeWindows
            .map((window: any) => {
              const startTime = String(window?.startTime || window?.start || '').trim();
              const endTime = String(window?.endTime || window?.end || '').trim();
              return startTime && endTime ? { startTime, endTime } : null;
            })
            .filter(
              (
                window: { startTime: string; endTime: string } | null
              ): window is { startTime: string; endTime: string } => !!window
            )
        : defaultDay.timeWindows;

      return {
        day: defaultDay.day,
        available: matched.available !== false && timeWindows.length > 0,
        timeWindows: timeWindows.length ? timeWindows : [...defaultDay.timeWindows],
      };
    });
  }

  private getDefaultDayEntry(dayOfWeek: string): any {
    return {
      day: dayOfWeek,
      available: true,
      timeWindows: [{ startTime: '09:00 AM', endTime: '05:00 PM' }],
    };
  }

  private applyBookedSessionsToTimeSlots(
    trainerId: string,
    date: string,
    timeSlots: TimeSlot[],
  ): void {
    const trainerAvailabilityRef = doc(this.firestore, `trainerAvailability/${trainerId}`);

    getDoc(trainerAvailabilityRef)
      .then((trainerAvailabilitySnap) => {
        let updatedTimeSlots = [...timeSlots];

        if (trainerAvailabilitySnap.exists() && trainerAvailabilitySnap.data()['bookedSessions']) {
          const bookedSessions = trainerAvailabilitySnap.data()['bookedSessions'] || [];

          const activeSessions = bookedSessions.filter(
            (session: any) => session.date === date && session.status !== 'cancelled'
          );

          if (activeSessions.length > 0) {
            updatedTimeSlots = updatedTimeSlots.map((slot) => {
              const slotTimeParts = this.parseTime(slot.time);
              const slotMinutes = slotTimeParts
                ? slotTimeParts.hour * 60 + slotTimeParts.minute
                : null;

              const isBooked = slotMinutes !== null && activeSessions.some((session: any) => {
                const startParts = this.parseTime(String(session.startTime || session.time || '').trim());
                if (!startParts) {
                  return false;
                }

                const startMinutes = startParts.hour * 60 + startParts.minute;

                const endParts = this.parseTime(String(session.endTime || '').trim());
                const fallbackDuration = Number(session.duration || 30) || 30;
                const endMinutes = endParts
                  ? endParts.hour * 60 + endParts.minute
                  : startMinutes + fallbackDuration;

                return slotMinutes >= startMinutes && slotMinutes < endMinutes;
              });
              return isBooked ? { ...slot, booked: true } : slot;
            });
          }
        }

        this.availableTimeSlots.set(updatedTimeSlots);
      })
      .catch((error) => {
        console.error('Error checking bookings:', error);
        this.availableTimeSlots.set(timeSlots);
      });
  }

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
    const dateObj = this.parseDateInput(date);
    if (!dateObj) {
      this.availableTimeSlots.set([]);
      return this.availableTimeSlots;
    }
    const dayOfWeek = dateObj.toLocaleString('en-US', { weekday: 'long' });
    
    // Check both possible document paths for trainer availability
    const trainerProfileRef = doc(this.firestore, 'trainers', trainerId);
    const trainerAvailabilityRef = doc(this.firestore, `trainerAvailability/${trainerId}`);
    this.stopRealtimeListeners();

    // Check both paths for availability data
    Promise.all([
      getDoc(trainerProfileRef),
      getDoc(trainerAvailabilityRef)
    ]).then(([trainerProfileSnap, availabilitySnap]) => {
      
      if (trainerProfileSnap.exists()) {
        const trainerData = trainerProfileSnap.data() as Record<string, unknown>;
        
        // Check if availability array exists in the trainer document
        const normalizedProfileAvailability = this.normalizeAvailabilityEntries(
          trainerData['availability']
        );
        if (normalizedProfileAvailability.length > 0) {
          this.processAvailabilityFromArray(
            trainerId,
            date,
            normalizedProfileAvailability,
            dayOfWeek
          );
          return; // Exit early if we found availability in the trainer document
        }
      }
      
      // If we get here, we didn't find availability in the trainer document, so check the availability document
      if (availabilitySnap.exists()) {
        const availabilityData = availabilitySnap.data();
        
        const normalizedAvailability = this.normalizeAvailabilityEntries(availabilityData['availability']);
        if (normalizedAvailability.length > 0) {
          this.processAvailabilityFromArray(trainerId, date, normalizedAvailability, dayOfWeek);
        } else {
          this.processAvailabilityFromArray(
            trainerId,
            date,
            [this.getDefaultDayEntry(dayOfWeek)],
            dayOfWeek
          );
        }
      } else {
        this.processAvailabilityFromArray(
          trainerId,
          date,
          [this.getDefaultDayEntry(dayOfWeek)],
          dayOfWeek
        );
      }
    }).catch(error => {
      console.error('DEBUG: Error getting trainer data:', error);
      this.processAvailabilityFromArray(
        trainerId,
        date,
        [this.getDefaultDayEntry(dayOfWeek)],
        dayOfWeek
      );
    });
    
    // Set up real-time listeners for changes
    this.trainerProfileUnsubscribe = onSnapshot(
      trainerProfileRef,
      (snapshot) => {
        const trainerData = snapshot.exists()
          ? (snapshot.data() as Record<string, unknown>)
          : null;
        const normalizedProfileAvailability = this.normalizeAvailabilityEntries(
          trainerData?.['availability']
        );
        if (normalizedProfileAvailability.length > 0) {
          this.processAvailabilityFromArray(
            trainerId,
            date,
            normalizedProfileAvailability,
            dayOfWeek
          );
        }
      },
      (error) => {
        console.error('DEBUG: Error in trainer profile listener:', error);
      }
    );
    
    this.trainerAvailabilityUnsubscribe = onSnapshot(trainerAvailabilityRef, (snapshot) => {
      if (snapshot.exists()) {
        const availabilityData = snapshot.data();
        const normalizedAvailability = this.normalizeAvailabilityEntries(availabilityData['availability']);
        if (normalizedAvailability.length > 0) {
          this.processAvailabilityFromArray(trainerId, date, normalizedAvailability, dayOfWeek);
        }
      }
    }, (error) => {
      console.error('DEBUG: Error in availability document listener:', error);
    });
    
    return this.availableTimeSlots;
  }

  private stopRealtimeListeners(): void {
    this.trainerProfileUnsubscribe?.();
    this.trainerAvailabilityUnsubscribe?.();
    this.trainerProfileUnsubscribe = null;
    this.trainerAvailabilityUnsubscribe = null;
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
      
      return dayMatches;
    });
    
    if (dayEntry) {
      // Check if the day is available
      if (dayEntry.available === false) {
        this.availableTimeSlots.set([]);
        return;
      }
      
      // Generate time slots from the availability
      const timeSlots = this.generateTimeSlotsFromArray(dayEntry);
      
      if (timeSlots.length === 0) {
        this.availableTimeSlots.set([]);
        return;
      }
      
      this.applyBookedSessionsToTimeSlots(trainerId, date, timeSlots);
    } else {
      const fallbackSlots = this.generateTimeSlotsFromArray(this.getDefaultDayEntry(dayOfWeek));
      this.applyBookedSessionsToTimeSlots(trainerId, date, fallbackSlots);
    }
  }
  
  /**
   * Generate time slots from an availability array entry
   * @param dayEntry The availability entry for a specific day
   * @returns An array of TimeSlot objects
   */
  private generateTimeSlotsFromArray(dayEntry: any): TimeSlot[] {
    const timeSlots: TimeSlot[] = [];

    const pushRange = (startLabel: string, endLabel: string) => {
      const startTimeParts = this.parseTime(startLabel);
      const endTimeParts = this.parseTime(endLabel);
      if (!startTimeParts || !endTimeParts) {
        return;
      }

      let currentHour = startTimeParts.hour;
      let currentMinute = startTimeParts.minute;
      const endHour = endTimeParts.hour;
      const endMinute = endTimeParts.minute;

      while (
        currentHour < endHour ||
        (currentHour === endHour && currentMinute <= endMinute)
      ) {
        const ampm = currentHour < 12 ? 'AM' : 'PM';
        const hour12 = currentHour % 12 || 12;
        const minuteStr = currentMinute === 0 ? '00' : '30';

        timeSlots.push({
          time: `${hour12}:${minuteStr} ${ampm}`,
          available: true,
          booked: false,
        });

        currentMinute += 30;
        if (currentMinute >= 60) {
          currentHour += 1;
          currentMinute = 0;
        }
      }
    };

    if (dayEntry.timeWindows && Array.isArray(dayEntry.timeWindows)) {
      for (const timeWindow of dayEntry.timeWindows) {
        if (timeWindow.startTime && timeWindow.endTime) {
          pushRange(timeWindow.startTime, timeWindow.endTime);
        }
      }
    } else if (dayEntry.times && Array.isArray(dayEntry.times)) {
      for (const timeBlock of dayEntry.times) {
        if (timeBlock.start && timeBlock.end) {
          pushRange(timeBlock.start, timeBlock.end);
        }
      }
    } else if (dayEntry.startTime && dayEntry.endTime) {
      pushRange(dayEntry.startTime, dayEntry.endTime);
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
    // Determine which document to update based on the flag
    const docPath = useTrainerAvailabilityCollection ? `trainerAvailability/${trainerId}` : `trainers/${trainerId}`;
    const docRef = doc(this.firestore, docPath);
    
    // Check if the document exists first
    return getDoc(docRef).then(docSnap => {
      if (docSnap.exists()) {
        return updateDoc(docRef, { availability: availabilityData });
      } else {
        return setDoc(docRef, { availability: availabilityData }, { merge: true });
      }
    });
  }

  async saveTrainerWeeklyAvailabilityEverywhere(
    trainerId: string,
    availabilityData: DayAvailability[],
  ): Promise<void> {
    const normalizedTrainerId = String(trainerId || '').trim();
    if (!normalizedTrainerId) {
      return;
    }

    const cleanedAvailability = availabilityData.map((day) => ({
      day: String(day.day || '').trim(),
      available: day.available !== false,
      timeWindows: Array.isArray(day.timeWindows)
        ? day.timeWindows
            .map((window) => ({
              startTime: String(window.startTime || '').trim(),
              endTime: String(window.endTime || '').trim(),
            }))
            .filter((window) => window.startTime && window.endTime)
        : [],
    }));

    await Promise.all([
      this.saveTrainerWeeklyAvailability(normalizedTrainerId, cleanedAvailability, false),
      this.saveTrainerWeeklyAvailability(normalizedTrainerId, cleanedAvailability, true),
    ]);
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
      return null;
    }
    
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
    
    return { hour, minute };
  }
}
