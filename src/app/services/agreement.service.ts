import { Injectable } from '@angular/core';
import { Firestore, collection, doc, getDoc, setDoc, updateDoc, arrayUnion, query, where, getDocs } from '@angular/fire/firestore';
import { BookingRequest, TimeSlot } from '../Interfaces/Calendar';
import { SessionRescheduleRequest } from '../Interfaces/SessionReschedule';

@Injectable({
  providedIn: 'root'
})
export class SessionBookingService {
  constructor(private firestore: Firestore) { }

  /**
   * Book a session at a specific time slot
   * @param bookingData The booking request data
   * @returns A promise that resolves to the booking ID
   */
  async bookSession(bookingData: BookingRequest): Promise<string> {
    console.log('Booking session with data:', bookingData);
    
    try {
      // Create a unique booking ID
      const bookingId = `${bookingData.trainerId}_${bookingData.clientId}_${bookingData.date}_${bookingData.time.replace(/\s+/g, '')}`;
      
      // Store the full booking details in bookings collection
      const bookingDetailsRef = doc(this.firestore, `bookings/${bookingId}`);
      await setDoc(bookingDetailsRef, {
        ...bookingData,
        bookingId,
        createdAt: new Date(),
        duration: bookingData.duration || 30 // Default to 30 minutes if not specified
      });
      
      // Add to bookedSessions array in trainerAvailability document
      const trainerAvailabilityRef = doc(this.firestore, `trainerAvailability/${bookingData.trainerId}`);
      const trainerAvailabilityDoc = await getDoc(trainerAvailabilityRef);
      
      const bookedSession = {
        clientId: bookingData.clientId,
        date: bookingData.date,
        startTime: bookingData.time,
        // Calculate end time based on duration
        endTime: bookingData.endTime || this.calculateEndTime(bookingData.time, bookingData.duration),
        bookingId: bookingId,
        status: bookingData.status,
        duration: bookingData.duration || 30 // Store duration in minutes
      };
      
      if (trainerAvailabilityDoc.exists()) {
        // Update existing document with new booked session
        await updateDoc(trainerAvailabilityRef, {
          bookedSessions: arrayUnion(bookedSession)
        });
      } else {
        // Create new document with booked session
        await setDoc(trainerAvailabilityRef, {
          bookedSessions: [bookedSession]
        }, { merge: true });
      }
      
      console.log('Booking created successfully with ID:', bookingId);
      return bookingId;
    } catch (error) {
      console.error('Error creating booking:', error);
      throw error;
    }
  }
  
  /**
   * Calculate the end time for a session based on duration
   * @param startTime The start time string (e.g., '2:00 PM')
   * @param durationMinutes The duration in minutes (default: 60)
   * @returns The end time string (e.g., '3:00 PM')
   */
  private calculateEndTime(startTime: string, durationMinutes: number = 60): string {
    const match = startTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return startTime; // Return original if format doesn't match
    
    let hour = parseInt(match[1], 10);
    let minute = parseInt(match[2], 10);
    const ampm = match[3].toUpperCase();
    
    // Convert to 24-hour format
    if (ampm === 'PM' && hour < 12) {
      hour += 12;
    } else if (ampm === 'AM' && hour === 12) {
      hour = 0;
    }
    
    // Calculate new time based on duration
    const totalMinutes = hour * 60 + minute + durationMinutes;
    hour = Math.floor(totalMinutes / 60) % 24;
    minute = totalMinutes % 60;
    
    // Convert back to 12-hour format
    let newAmPm = hour >= 12 ? 'PM' : 'AM';
    let newHour = hour % 12;
    if (newHour === 0) newHour = 12;
    
    return `${newHour}:${String(minute).padStart(2, '0')} ${newAmPm}`;
  }
  
  /**
   * Update a time slot's booked status
   * @param trainerId The ID of the trainer
   * @param date The date of the booking
   * @param time The time of the booking
   * @param booked Whether the time slot is booked
   * @param clientId Optional client ID for booking
   */
  async updateTimeSlotStatus(trainerId: string, date: string, time: string, booked: boolean, clientId?: string): Promise<void> {
    console.log(`Updating time slot status for ${trainerId} on ${date} at ${time} to ${booked ? 'booked' : 'available'}`);
    
    try {
      const trainerAvailabilityRef = doc(this.firestore, `trainerAvailability/${trainerId}`);
      const trainerAvailabilityDoc = await getDoc(trainerAvailabilityRef);
      
      if (booked && clientId) {
        // Add a new booking
        const bookingId = `${trainerId}_${clientId}_${date}_${time.replace(/\s+/g, '')}`;
        
        const bookedSession = {
          clientId: clientId,
          date: date,
          startTime: time,
          endTime: this.calculateEndTime(time),
          bookingId: bookingId,
          status: 'confirmed' as 'confirmed'
        };
        
        if (trainerAvailabilityDoc.exists()) {
          await updateDoc(trainerAvailabilityRef, {
            bookedSessions: arrayUnion(bookedSession)
          });
        } else {
          await setDoc(trainerAvailabilityRef, {
            bookedSessions: [bookedSession]
          }, { merge: true });
        }
      } else if (!booked) {
        // Remove a booking
        if (trainerAvailabilityDoc.exists() && trainerAvailabilityDoc.data()['bookedSessions']) {
          const bookedSessions = trainerAvailabilityDoc.data()['bookedSessions'] || [];
          
          // Filter out the booking for this time slot
          const updatedSessions = bookedSessions.filter((session: any) => 
            !(session.date === date && session.startTime === time)
          );
          
          // Update the document with the filtered sessions
          await updateDoc(trainerAvailabilityRef, {
            bookedSessions: updatedSessions
          });
        }
      }
      
      console.log('Time slot status updated successfully');
    } catch (error) {
      console.error('Error updating time slot status:', error);
      throw error;
    }
  }
  
  /**
   * Get all bookings for a trainer
   * @param trainerId The ID of the trainer
   * @returns A promise that resolves to an object with dates as keys and arrays of booked times as values
   */
  async getTrainerBookings(trainerId: string): Promise<Record<string, string[]>> {
    console.log(`Getting bookings for trainer ${trainerId}`);
    
    try {
      const trainerAvailabilityRef = doc(this.firestore, `trainerAvailability/${trainerId}`);
      const trainerAvailabilityDoc = await getDoc(trainerAvailabilityRef);
      
      if (trainerAvailabilityDoc.exists() && trainerAvailabilityDoc.data()['bookedSessions']) {
        const bookedSessions = trainerAvailabilityDoc.data()['bookedSessions'] || [];
        
        // Convert the bookedSessions array to the expected format
        const result: Record<string, string[]> = {};
        
        bookedSessions.forEach((session: any) => {
          if (session.status !== 'cancelled') {
            if (!result[session.date]) {
              result[session.date] = [];
            }
            result[session.date].push(session.startTime);
          }
        });
        
        return result;
      } else {
        return {};
      }
    } catch (error) {
      console.error('Error getting trainer bookings:', error);
      throw error;
    }
  }
  
  /**
   * Get all bookings for a client
   * @param clientId The ID of the client
   * @returns A promise that resolves to an array of booking details
   */
  async getClientBookings(clientId: string): Promise<any[]> {
    console.log(`Getting bookings for client ${clientId}`);
    
    try {
      // Query the bookings collection for bookings with this client ID
      const bookingsCollectionRef = collection(this.firestore, 'bookings');
      const q = query(bookingsCollectionRef, where('clientId', '==', clientId));
      const querySnapshot = await getDocs(q);
      
      const bookings: any[] = [];
      querySnapshot.forEach((doc) => {
        bookings.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      return bookings;
    } catch (error) {
      console.error('Error getting client bookings:', error);
      throw error;
    }
  }
  
  /**
   * Get all booked sessions for a trainer
   * @param trainerId The ID of the trainer
   * @returns A promise that resolves to an array of booked sessions
   */
  async getTrainerBookedSessions(trainerId: string): Promise<any[]> {
    console.log(`Getting booked sessions for trainer ${trainerId}`);
    
    try {
      const trainerAvailabilityRef = doc(this.firestore, `trainerAvailability/${trainerId}`);
      const trainerAvailabilityDoc = await getDoc(trainerAvailabilityRef);
      
      if (trainerAvailabilityDoc.exists() && trainerAvailabilityDoc.data()['bookedSessions']) {
        return trainerAvailabilityDoc.data()['bookedSessions'];
      } else {
        return [];
      }
    } catch (error) {
      console.error('Error getting trainer booked sessions:', error);
      throw error;
    }
  }
  
  /**
   * Cancel a booked session
   * @param trainerId The ID of the trainer
   * @param bookingId The ID of the booking to cancel
   * @returns A promise that resolves when the booking is cancelled
   */
  async cancelBookedSession(trainerId: string, bookingId: string): Promise<void> {
    console.log(`Cancelling booking ${bookingId} for trainer ${trainerId}`);
    
    try {
      // Get the current booked sessions
      const trainerAvailabilityRef = doc(this.firestore, `trainerAvailability/${trainerId}`);
      const trainerAvailabilityDoc = await getDoc(trainerAvailabilityRef);
      
      if (trainerAvailabilityDoc.exists() && trainerAvailabilityDoc.data()['bookedSessions']) {
        const bookedSessions = trainerAvailabilityDoc.data()['bookedSessions'];
        
        // Find the booking to cancel
        const updatedSessions = bookedSessions.map((session: any) => {
          if (session.bookingId === bookingId) {
            return { ...session, status: 'cancelled' };
          }
          return session;
        });
        
        // Update the document with the modified sessions
        await updateDoc(trainerAvailabilityRef, {
          bookedSessions: updatedSessions
        });
        
        // Also update the booking document
        const bookingRef = doc(this.firestore, `bookings/${bookingId}`);
        await updateDoc(bookingRef, {
          status: 'cancelled'
        });
      }
    } catch (error) {
      console.error('Error cancelling booked session:', error);
      throw error;
    }
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
   * Group consecutive time slots into sessions
   * @param timeSlots Array of time slot strings (e.g., ['2:00 PM', '2:30 PM', '3:00 PM'])
   * @returns Array of grouped sessions with start time and duration
   */
  groupConsecutiveTimeSlots(timeSlots: string[]): { startTime: string, endTime: string, duration: number }[] {
    if (!timeSlots || timeSlots.length === 0) return [];
    
    // Sort time slots chronologically
    const sortedTimeSlots = [...timeSlots].sort((a, b) => {
      const timeA = this.parseTimeToMinutes(a);
      const timeB = this.parseTimeToMinutes(b);
      return timeA - timeB;
    });
    
    const sessions: { startTime: string, endTime: string, duration: number }[] = [];
    let currentSession: { startTime: string, timeSlots: string[] } = {
      startTime: sortedTimeSlots[0],
      timeSlots: [sortedTimeSlots[0]]
    };
    
    // Process each time slot after the first one
    for (let i = 1; i < sortedTimeSlots.length; i++) {
      const currentTime = sortedTimeSlots[i];
      const previousTime = sortedTimeSlots[i - 1];
      
      // Check if current time slot is consecutive to the previous one (30 min difference)
      const currentMinutes = this.parseTimeToMinutes(currentTime);
      const previousMinutes = this.parseTimeToMinutes(previousTime);
      
      if (currentMinutes - previousMinutes === 30) {
        // Add to current session if consecutive
        currentSession.timeSlots.push(currentTime);
      } else {
        // Finish the current session and start a new one
        const duration = currentSession.timeSlots.length * 30; // Each slot is 30 minutes
        sessions.push({
          startTime: currentSession.startTime,
          endTime: this.calculateEndTime(currentSession.startTime, duration),
          duration
        });
        
        // Start a new session
        currentSession = {
          startTime: currentTime,
          timeSlots: [currentTime]
        };
      }
    }
    
    // Add the last session
    const duration = currentSession.timeSlots.length * 30;
    sessions.push({
      startTime: currentSession.startTime,
      endTime: this.calculateEndTime(currentSession.startTime, duration),
      duration
    });
    
    return sessions;
  }
  
  /**
   * Parse a time string to minutes since midnight for comparison
   * @param timeStr Time string in format '2:00 PM'
   * @returns Minutes since midnight
   */
  private parseTimeToMinutes(timeStr: string): number {
    const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return 0;
    
    let hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    const ampm = match[3].toUpperCase();
    
    // Convert to 24-hour format
    if (ampm === 'PM' && hour < 12) {
      hour += 12;
    } else if (ampm === 'AM' && hour === 12) {
      hour = 0;
    }
    
    return hour * 60 + minute;
  }
  
  /**
   * Book multiple consecutive time slots as a single session
   * @param trainerId The trainer's ID
   * @param clientId The client's ID
   * @param date The booking date
   * @param timeSlots Array of selected time slots
   * @returns A promise that resolves to an array of booking IDs
   */
  async bookConsecutiveSessions(trainerId: string, clientId: string, date: string, timeSlots: string[]): Promise<string[]> {
    console.log('Booking consecutive sessions:', { trainerId, clientId, date, timeSlots });
    
    try {
      // Group consecutive time slots
      const sessions = this.groupConsecutiveTimeSlots(timeSlots);
      console.log('Grouped into sessions:', sessions);
      
      // Book each session
      const bookingPromises = sessions.map(session => {
        const bookingData: BookingRequest & { endTime?: string, duration?: number } = {
          trainerId,
          clientId,
          date,
          time: session.startTime,
          endTime: session.endTime,
          duration: session.duration,
          status: 'confirmed' as 'confirmed',
          createdAt: new Date()
        };
        return this.bookSession(bookingData);
      });
      
      // Wait for all bookings to complete
      const bookingIds = await Promise.all(bookingPromises);
      console.log('Created bookings with IDs:', bookingIds);
      
      return bookingIds;
    } catch (error) {
      console.error('Error booking consecutive sessions:', error);
      throw error;
    }
  }
  
  /**
   * Get upcoming sessions for the current week for a user (either trainer or client)
   * @param userId The ID of the user
   * @param userType Whether the user is a 'trainer' or 'client'
   * @returns A promise that resolves to an array of upcoming sessions
   */
  async getUpcomingWeekSessions(userId: string, userType: 'trainer' | 'client'): Promise<any[]> {
    console.log(`Getting upcoming week sessions for ${userType} ${userId}`);
    
    try {
      // Get all bookings for the user
      let bookings: any[] = [];
      
      // For clients, use the client-specific method that already works
      if (userType === 'client') {
        // Use the existing method that works for clients
        bookings = await this.getClientBookings(userId);
      } else {
        // For trainers, use the trainer-specific method that already works
        const trainerSessions = await this.getTrainerBookedSessions(userId);
        
        // Map trainer sessions to have consistent field names with client bookings
        bookings = trainerSessions.map(session => ({
          id: session.bookingId || '',
          trainerId: userId,
          clientId: session.clientId || '',
          date: session.date || '',
          // Ensure time field is consistent (startTime → time)
          time: session.startTime || '',
          // Ensure endTime is always set
          endTime: session.endTime || this.calculateEndTime(session.startTime || ''),
          status: session.status || 'confirmed'
        }));
      }
      
      // Calculate the date range for the current week (today to 7 days from now)
      const today = new Date();
      const nextWeek = new Date();
      nextWeek.setDate(today.getDate() + 7);
      
      const todayFormatted = this.formatDate(today);
      const nextWeekFormatted = this.formatDate(nextWeek);
      
      // Filter bookings to only include those in the current week and not cancelled
      const upcomingBookings = bookings.filter(booking => {
        // Skip cancelled bookings
        if (booking.status === 'cancelled') return false;
        
        // Check if the booking date is within the current week
        return booking.date >= todayFormatted && booking.date <= nextWeekFormatted;
      });
      
      // Ensure all bookings have the required fields
      const standardizedBookings = upcomingBookings.map(booking => {
        // Make sure time and endTime are always set
        const time = booking.time || (booking.startTime || '');
        const endTime = booking.endTime || this.calculateEndTime(time);
        
        return {
          ...booking,
          time,
          endTime
        };
      });
      
      // Sort bookings by date and time
      standardizedBookings.sort((a, b) => {
        // Safely handle potentially undefined date properties
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;  // a is undefined, b comes first
        if (!b.date) return -1; // b is undefined, a comes first
        
        if (a.date !== b.date) {
          return a.date.localeCompare(b.date);
        }
        
        // Safely handle potentially undefined time properties
        if (!a.time && !b.time) return 0;
        if (!a.time) return 1;  // a is undefined, b comes first
        if (!b.time) return -1; // b is undefined, a comes first
        
        return a.time.localeCompare(b.time);
      });
      
      return standardizedBookings;
    } catch (error) {
      console.error(`Error getting upcoming week sessions for ${userType}:`, error);
      // Return empty array instead of throwing to avoid breaking the UI
      return [];
    }
  }

  /**
   * Create a session reschedule request
   * @param originalSession The original session data
   * @param newDate The new date for the session
   * @param newTime The new time for the session
   * @param reason The reason for rescheduling
   * @param requestedBy Who requested the reschedule (trainer or client)
   * @returns A promise that resolves to the reschedule request ID
   */
  async createSessionRescheduleRequest(
    originalSession: any,
    newDate: string,
    newTime: string,
    reason: string,
    requestedBy: 'trainer' | 'client'
  ): Promise<string> {
    console.log('Creating session reschedule request:', {
      originalSession,
      newDate,
      newTime,
      reason,
      requestedBy
    });
    
    try {
      // 1. Immediately cancel the original session
      await this.cancelBookedSession(originalSession.trainerId, originalSession.id);
      console.log(`Original booking ${originalSession.id} cancelled immediately`);
      
      // 2. Make sure it's removed from the trainer's bookedSessions array
      const trainerAvailabilityRef = doc(this.firestore, `trainerAvailability/${originalSession.trainerId}`);
      const trainerAvailabilityDoc = await getDoc(trainerAvailabilityRef);
      
      if (trainerAvailabilityDoc.exists() && trainerAvailabilityDoc.data()['bookedSessions']) {
        const bookedSessions = trainerAvailabilityDoc.data()['bookedSessions'];
        
        // Remove the original session from the bookedSessions array
        const updatedSessions = bookedSessions.filter((session: any) => {
          return session.bookingId !== originalSession.id && session.id !== originalSession.id;
        });
        
        // Update the document with the filtered sessions
        await updateDoc(trainerAvailabilityRef, {
          bookedSessions: updatedSessions
        });
        console.log(`Original booking removed from trainer's bookedSessions array`);
      }
      
      // 3. Create a new booking with pending status for the new time
      const newBookingData: BookingRequest = {
        trainerId: originalSession.trainerId,
        clientId: originalSession.clientId,
        date: newDate,
        time: newTime,
        status: 'pending',
        createdAt: new Date()
      };
      
      // Calculate end time and duration based on original session if available
      if (originalSession.duration) {
        newBookingData.duration = originalSession.duration;
      }
      
      // Book the new session with pending status
      const newBookingId = await this.bookSession(newBookingData);
      console.log(`New booking created with ID: ${newBookingId}`);
      
      // 4. Create a reschedule request document
      const rescheduleRequest: SessionRescheduleRequest = {
        originalBookingId: originalSession.id,
        newBookingId: newBookingId,
        trainerId: originalSession.trainerId,
        clientId: originalSession.clientId,
        originalDate: originalSession.date,
        originalTime: originalSession.time,
        newDate: newDate,
        newTime: newTime,
        reason: reason,
        status: 'pending',
        requestedBy: requestedBy,
        createdAt: new Date().toISOString()
      };
      
      // 5. Save the reschedule request to Firestore
      const rescheduleRequestId = `${originalSession.id}_reschedule_${newBookingId}`;
      const rescheduleRequestRef = doc(this.firestore, `sessionReschedules/${rescheduleRequestId}`);
      await setDoc(rescheduleRequestRef, rescheduleRequest);
      
      console.log('Session reschedule request created with ID:', rescheduleRequestId);
      return rescheduleRequestId;
    } catch (error) {
      console.error('Error creating session reschedule request:', error);
      throw error;
    }
  }

  /**
   * Accept a session reschedule request
   * @param rescheduleRequestId The ID of the reschedule request
   * @returns A promise that resolves when the request is accepted
   */
  async acceptSessionRescheduleRequest(rescheduleRequestId: string): Promise<void> {
    console.log('Accepting session reschedule request:', rescheduleRequestId);
    
    try {
      // Get the reschedule request
      const rescheduleRequestRef = doc(this.firestore, `sessionReschedules/${rescheduleRequestId}`);
      const rescheduleRequestDoc = await getDoc(rescheduleRequestRef);
      
      if (!rescheduleRequestDoc.exists()) {
        throw new Error(`Reschedule request ${rescheduleRequestId} not found`);
      }
      
      const rescheduleRequest = rescheduleRequestDoc.data() as SessionRescheduleRequest;
      
      // 1. First, cancel the original booking in the bookings collection
      const originalBookingRef = doc(this.firestore, `bookings/${rescheduleRequest.originalBookingId}`);
      await updateDoc(originalBookingRef, { status: 'cancelled' });
      console.log(`Original booking ${rescheduleRequest.originalBookingId} marked as cancelled`);
      
      // 2. Also remove it from the trainer's bookedSessions array or update its status
      const trainerAvailabilityRef = doc(this.firestore, `trainerAvailability/${rescheduleRequest.trainerId}`);
      const trainerAvailabilityDoc = await getDoc(trainerAvailabilityRef);
      
      if (trainerAvailabilityDoc.exists() && trainerAvailabilityDoc.data()['bookedSessions']) {
        const bookedSessions = trainerAvailabilityDoc.data()['bookedSessions'];
        
        // Filter out the cancelled session or mark it as cancelled
        const updatedSessions = bookedSessions.map((session: any) => {
          if (session.bookingId === rescheduleRequest.originalBookingId || 
              session.id === rescheduleRequest.originalBookingId) {
            return { ...session, status: 'cancelled' };
          }
          return session;
        });
        
        // Update the document with the modified sessions
        await updateDoc(trainerAvailabilityRef, {
          bookedSessions: updatedSessions
        });
        console.log(`Original booking removed from trainer's bookedSessions array`);
      }
      
      // 3. Update the new booking to confirmed status
      if (rescheduleRequest.newBookingId) {
        const newBookingRef = doc(this.firestore, `bookings/${rescheduleRequest.newBookingId}`);
        await updateDoc(newBookingRef, { status: 'confirmed' });
        console.log(`New booking ${rescheduleRequest.newBookingId} marked as confirmed`);
        
        // Also update in the trainer's bookedSessions array
        if (trainerAvailabilityDoc.exists() && trainerAvailabilityDoc.data()['bookedSessions']) {
          const bookedSessions = trainerAvailabilityDoc.data()['bookedSessions'];
          
          // Find the booking to update
          const updatedSessions = bookedSessions.map((session: any) => {
            if (session.bookingId === rescheduleRequest.newBookingId || 
                session.id === rescheduleRequest.newBookingId) {
              return { ...session, status: 'confirmed' };
            }
            return session;
          });
          
          // Update the document with the modified sessions
          await updateDoc(trainerAvailabilityRef, {
            bookedSessions: updatedSessions
          });
          console.log(`New booking updated in trainer's bookedSessions array`);
        }
      }
      
      // 4. Update the reschedule request status to accepted
      await updateDoc(rescheduleRequestRef, { status: 'accepted' });
      
      console.log('Session reschedule request accepted successfully');
    } catch (error) {
      console.error('Error accepting session reschedule request:', error);
      throw error;
    }
  }

  /**
   * Reject a session reschedule request
   * @param rescheduleRequestId The ID of the reschedule request
   * @returns A promise that resolves when the request is rejected
   */
  async rejectSessionRescheduleRequest(rescheduleRequestId: string): Promise<void> {
    console.log('Rejecting session reschedule request:', rescheduleRequestId);
    
    try {
      // Get the reschedule request
      const rescheduleRequestRef = doc(this.firestore, `sessionReschedules/${rescheduleRequestId}`);
      const rescheduleRequestDoc = await getDoc(rescheduleRequestRef);
      
      if (!rescheduleRequestDoc.exists()) {
        throw new Error(`Reschedule request ${rescheduleRequestId} not found`);
      }
      
      const rescheduleRequest = rescheduleRequestDoc.data() as SessionRescheduleRequest;
      
      // Cancel the new booking (since it's being rejected)
      if (rescheduleRequest.newBookingId) {
        await this.cancelBookedSession(rescheduleRequest.trainerId, rescheduleRequest.newBookingId);
      }
      
      // Update the reschedule request status to rejected
      await updateDoc(rescheduleRequestRef, { status: 'rejected' });
      
      console.log('Session reschedule request rejected successfully');
    } catch (error) {
      console.error('Error rejecting session reschedule request:', error);
      throw error;
    }
  }

  /**
   * Get all session reschedule requests for a user
   * @param userId The ID of the user
   * @param userType Whether the user is a trainer or client
   * @returns A promise that resolves to an array of reschedule requests
   */
  async getSessionRescheduleRequests(userId: string, userType: 'trainer' | 'client'): Promise<SessionRescheduleRequest[]> {
    console.log(`Getting session reschedule requests for ${userType} ${userId}`);
    
    try {
      // Determine which field to query based on user type
      const fieldName = userType === 'trainer' ? 'trainerId' : 'clientId';
      
      // Query the sessionReschedules collection
      const rescheduleRequestsRef = collection(this.firestore, 'sessionReschedules');
      const q = query(rescheduleRequestsRef, where(fieldName, '==', userId));
      const querySnapshot = await getDocs(q);
      
      const rescheduleRequests: SessionRescheduleRequest[] = [];
      querySnapshot.forEach((doc) => {
        rescheduleRequests.push(doc.data() as SessionRescheduleRequest);
      });
      
      return rescheduleRequests;
    } catch (error) {
      console.error(`Error getting session reschedule requests for ${userType}:`, error);
      return [];
    }
  }

  /**
   * Get a single session reschedule request by ID
   * @param rescheduleRequestId The ID of the reschedule request
   * @returns A promise that resolves to the reschedule request or null if not found
   */
  async getSessionRescheduleRequestById(rescheduleRequestId: string): Promise<SessionRescheduleRequest | null> {
    console.log('Getting session reschedule request by ID:', rescheduleRequestId);
    
    try {
      const rescheduleRequestRef = doc(this.firestore, `sessionReschedules/${rescheduleRequestId}`);
      const rescheduleRequestDoc = await getDoc(rescheduleRequestRef);
      
      if (rescheduleRequestDoc.exists()) {
        return rescheduleRequestDoc.data() as SessionRescheduleRequest;
      } else {
        return null;
      }
    } catch (error) {
      console.error('Error getting session reschedule request by ID:', error);
      return null;
    }
  }
}
