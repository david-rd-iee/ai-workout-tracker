import { Injectable } from '@angular/core';
import { Firestore, collection, doc, getDoc, setDoc, updateDoc, query, where, getDocs } from '@angular/fire/firestore';
import { Database, ref, get } from '@angular/fire/database';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { SessionRescheduleRequest } from '../Interfaces/SessionReschedule';
import { BookingData } from '../Interfaces/Booking';

const DEFAULT_TIMEZONE = 'America/Los_Angeles';

@Injectable({
  providedIn: 'root'
})
export class BookingService {
  constructor(
    private firestore: Firestore,
    private db: Database,
    private functions: Functions
  ) { }

  /**
   * Book a session (online or in-person)
   * Note: The Cloud Function will convert local date/time to UTC and update the booking
   */
  async bookSession(bookingData: BookingData): Promise<string> {
    console.log('Booking session:', bookingData);
    
    try {
      // Generate a unique booking ID using UTC timestamp
      const timestamp = Date.now();
      const bookingId = `${bookingData.trainerId}_${bookingData.clientId}_${timestamp}`;
      
      const bookingRef = doc(this.firestore, `bookings/${bookingId}`);
      
      // Fetch trainer and client profiles to get names if not already provided
      let clientFirstName = bookingData.clientFirstName;
      let clientLastName = bookingData.clientLastName;
      let trainerFirstName = bookingData.trainerFirstName;
      let trainerLastName = bookingData.trainerLastName;
      
      if (!clientFirstName || !clientLastName || !trainerFirstName || !trainerLastName) {
        const [trainerDoc, clientDoc] = await Promise.all([
          getDoc(doc(this.firestore, `trainers/${bookingData.trainerId}`)),
          getDoc(doc(this.firestore, `clients/${bookingData.clientId}`))
        ]);
        
        const trainerData = trainerDoc.data();
        const clientData = clientDoc.data();
        
        clientFirstName = clientFirstName || clientData?.['firstName'];
        clientLastName = clientLastName || clientData?.['lastName'];
        trainerFirstName = trainerFirstName || trainerData?.['firstName'];
        trainerLastName = trainerLastName || trainerData?.['lastName'];
      }
      
      // Store initial booking data - the Cloud Function will add UTC timestamps
      await setDoc(bookingRef, {
        trainerId: bookingData.trainerId,
        clientId: bookingData.clientId,
        startTimeUTC: bookingData.startTimeUTC,
        endTimeUTC: bookingData.endTimeUTC,
        timezone: bookingData.timezone || DEFAULT_TIMEZONE,
        duration: bookingData.duration,
        status: bookingData.status || 'confirmed',
        sessionType: bookingData.sessionType,
        location: bookingData.location,
        clientFirstName,
        clientLastName,
        trainerFirstName,
        trainerLastName,
        bookingId,
        createdAt: new Date()
      });
      
      console.log('Session booked successfully:', bookingId);
      
      // Trigger Google Calendar event creation and message sending via Cloud Function (non-blocking)
      // The Cloud Function will handle calendar event creation and chat message sending
      try {
        const createCalendarEvent = httpsCallable(this.functions, 'createSessionCalendarEvent');
        createCalendarEvent({
          bookingId,
          trainerId: bookingData.trainerId,
          clientId: bookingData.clientId,
          startTimeUTC: bookingData.startTimeUTC,
          endTimeUTC: bookingData.endTimeUTC,
          timezone: bookingData.timezone,
          duration: bookingData.duration,
          sessionType: bookingData.sessionType,
          location: bookingData.sessionType === 'in-person' ? bookingData.location : undefined
        }).then(() => {
          console.log('Calendar event and message creation triggered for booking:', bookingId);
        }).catch((error) => {
          console.error('Error triggering calendar event (non-blocking):', error);
        });
      } catch (error) {
        console.error('Error calling calendar function (non-blocking):', error);
      }
      
      return bookingId;
    } catch (error) {
      console.error('Error booking session:', error);
      throw error;
    }
  }

  /**
   * Get a booking by ID
   */
  async getBookingById(bookingId: string): Promise<any | null> {
    try {
      const bookingRef = doc(this.firestore, `bookings/${bookingId}`);
      const bookingDoc = await getDoc(bookingRef);
      
      if (bookingDoc.exists()) {
        return {
          id: bookingDoc.id,
          ...bookingDoc.data()
        };
      }
      return null;
    } catch (error) {
      console.error('Error getting booking:', error);
      throw error;
    }
  }

  /**
   * Get all bookings for a user (trainer or client)
   */
  async getUserBookings(userId: string, userType: 'trainer' | 'client'): Promise<any[]> {
    try {
      const bookingsRef = collection(this.firestore, 'bookings');
      const fieldName = userType === 'trainer' ? 'trainerId' : 'clientId';
      const q = query(bookingsRef, where(fieldName, '==', userId));
      const querySnapshot = await getDocs(q);
      
      const bookings: any[] = [];
      querySnapshot.forEach((doc) => {
        bookings.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      return bookings.filter(b => b.status !== 'cancelled');
    } catch (error) {
      console.error('Error getting user bookings:', error);
      throw error;
    }
  }

  /**
   * Get upcoming sessions for current week
   */
  async getUpcomingWeekSessions(userId: string, userType: 'trainer' | 'client'): Promise<any[]> {
    try {
      const allBookings = await this.getUserBookings(userId, userType);
      
      const now = new Date();
      const nextWeek = new Date();
      nextWeek.setDate(now.getDate() + 7);
      
      return allBookings
        .filter(booking => {
          if (booking.startTimeUTC) {
            const sessionDate = new Date(booking.startTimeUTC);
            return sessionDate >= now && sessionDate <= nextWeek;
          }
          return false;
        })
        .sort((a, b) => {
          const dateA = new Date(a.startTimeUTC);
          const dateB = new Date(b.startTimeUTC);
          return dateA.getTime() - dateB.getTime();
        });
    } catch (error) {
      console.error('Error getting upcoming sessions:', error);
      return [];
    }
  }

  /**
   * Cancel a booking
   */
  async cancelBooking(bookingId: string): Promise<void> {
    try {
      const bookingRef = doc(this.firestore, `bookings/${bookingId}`);
      await updateDoc(bookingRef, { status: 'cancelled' });
      console.log('Booking cancelled:', bookingId);
    } catch (error) {
      console.error('Error cancelling booking:', error);
      throw error;
    }
  }

  /**
   * Create a reschedule request
   * @param originalBooking - The original booking to reschedule
   * @param newDate - New date in YYYY-MM-DD format
   * @param newTime - New time in "3:15 PM" format
   * @param reason - Reason for rescheduling
   * @param requestedBy - Who requested the reschedule
   * @param timezone - IANA timezone string (defaults to original booking's timezone)
   */
  async createRescheduleRequest(
    originalBooking: any,
    newDate: string,
    newTime: string,
    reason: string,
    requestedBy: 'trainer' | 'client',
    timezone?: string
  ): Promise<string> {
    try {
      await this.cancelBooking(originalBooking.id);
      
      // Use original booking's timezone or default
      const tz = timezone || originalBooking.timezone || DEFAULT_TIMEZONE;
      
      // Convert new local date/time to UTC
      const newStartTimeUTC = this.toUTC(newDate, newTime, tz);
      const newEndTimeUTC = this.calculateEndTimeUTC(newStartTimeUTC, originalBooking.duration);
      
      const newBookingData: BookingData = {
        trainerId: originalBooking.trainerId,
        clientId: originalBooking.clientId,
        startTimeUTC: newStartTimeUTC,
        endTimeUTC: newEndTimeUTC,
        timezone: tz,
        duration: originalBooking.duration,
        status: 'pending',
        sessionType: originalBooking.sessionType,
        location: originalBooking.location,
        createdAt: new Date()
      };
      
      const newBookingId = await this.bookSession(newBookingData);
      
      const rescheduleRequest: SessionRescheduleRequest = {
        originalBookingId: originalBooking.id,
        newBookingId: newBookingId,
        trainerId: originalBooking.trainerId,
        clientId: originalBooking.clientId,
        originalStartTimeUTC: originalBooking.startTimeUTC,
        newStartTimeUTC: newStartTimeUTC,
        timezone: tz,
        reason: reason,
        status: 'pending',
        requestedBy: requestedBy,
        createdAt: new Date().toISOString()
      };
      
      const rescheduleId = `${originalBooking.id}_reschedule_${newBookingId}`;
      const rescheduleRef = doc(this.firestore, `sessionReschedules/${rescheduleId}`);
      await setDoc(rescheduleRef, rescheduleRequest);
      
      console.log('Reschedule request created:', rescheduleId);
      
      return rescheduleId;
    } catch (error) {
      console.error('Error creating reschedule request:', error);
      throw error;
    }
  }

  /**
   * Accept a reschedule request
   */
  async acceptRescheduleRequest(rescheduleId: string): Promise<void> {
    try {
      const rescheduleRef = doc(this.firestore, `sessionReschedules/${rescheduleId}`);
      const rescheduleDoc = await getDoc(rescheduleRef);
      
      if (!rescheduleDoc.exists()) {
        throw new Error('Reschedule request not found');
      }
      
      const reschedule = rescheduleDoc.data() as SessionRescheduleRequest;
      
      const newBookingRef = doc(this.firestore, `bookings/${reschedule.newBookingId}`);
      await updateDoc(newBookingRef, { status: 'confirmed' });
      
      await updateDoc(rescheduleRef, { status: 'accepted' });
      
      console.log('Reschedule request accepted:', rescheduleId);
    } catch (error) {
      console.error('Error accepting reschedule request:', error);
      throw error;
    }
  }

  /**
   * Reject a reschedule request
   */
  async rejectRescheduleRequest(rescheduleId: string): Promise<void> {
    try {
      const rescheduleRef = doc(this.firestore, `sessionReschedules/${rescheduleId}`);
      const rescheduleDoc = await getDoc(rescheduleRef);
      
      if (!rescheduleDoc.exists()) {
        throw new Error('Reschedule request not found');
      }
      
      const reschedule = rescheduleDoc.data() as SessionRescheduleRequest;
      
      if (reschedule.newBookingId) {
        await this.cancelBooking(reschedule.newBookingId);
      }
      await updateDoc(rescheduleRef, { status: 'rejected' });
      
      console.log('Reschedule request rejected:', rescheduleId);
    } catch (error) {
      console.error('Error rejecting reschedule request:', error);
      throw error;
    }
  }

  /**
   * Get a reschedule request by ID
   */
  async getRescheduleRequestById(rescheduleId: string): Promise<SessionRescheduleRequest | null> {
    try {
      const rescheduleRef = doc(this.firestore, `sessionReschedules/${rescheduleId}`);
      const rescheduleDoc = await getDoc(rescheduleRef);
      
      if (rescheduleDoc.exists()) {
        return rescheduleDoc.data() as SessionRescheduleRequest;
      }
      return null;
    } catch (error) {
      console.error('Error getting reschedule request:', error);
      throw error;
    }
  }

  /**
   * Find or create a chat between two users
   */
  async findOrCreateChat(userId1: string, userId2: string): Promise<string | null> {
    try {
      const userChatsRef = ref(this.db, `userChats/${userId1}`);
      const userChatsSnapshot = await get(userChatsRef);
      
      if (userChatsSnapshot.exists()) {
        const chatIds = Object.keys(userChatsSnapshot.val());
        
        for (const chatId of chatIds) {
          const chatRef = ref(this.db, `chats/${chatId}`);
          const chatSnapshot = await get(chatRef);
          
          if (chatSnapshot.exists()) {
            const chatData = chatSnapshot.val();
            if (chatData.participants && chatData.participants.includes(userId2)) {
              return chatId;
            }
          }
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error finding chat:', error);
      return null;
    }
  }

  /**
   * Convert local date/time to UTC ISO string
   */
  toUTC(date: string, time: string, timezone: string): string {
    const minutes = this.parseTimeToMinutes(time);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    const tzOffset = this.getTimezoneOffset(date, timezone);
    const localIsoString = `${date}T${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:00${tzOffset}`;
    const utcDate = new Date(localIsoString);
    
    return utcDate.toISOString();
  }

  /**
   * Calculate end time UTC from start time UTC and duration
   */
  calculateEndTimeUTC(startTimeUTC: string, duration: number): string {
    const startDate = new Date(startTimeUTC);
    const endDate = new Date(startDate.getTime() + duration * 60 * 1000);
    return endDate.toISOString();
  }

  /**
   * Format UTC timestamp to local time display string
   */
  formatTimeForDisplay(utcTimestamp: string, timezone: string): string {
    const date = new Date(utcTimestamp);
    return date.toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  /**
   * Format UTC timestamp to local date display string (YYYY-MM-DD)
   */
  formatDateForDisplay(utcTimestamp: string, timezone: string): string {
    const date = new Date(utcTimestamp);
    const year = date.toLocaleString('en-US', { timeZone: timezone, year: 'numeric' });
    const month = date.toLocaleString('en-US', { timeZone: timezone, month: '2-digit' });
    const day = date.toLocaleString('en-US', { timeZone: timezone, day: '2-digit' });
    return `${year}-${month}-${day}`;
  }

  /**
   * Get timezone offset string for a given date and timezone
   */
  private getTimezoneOffset(dateStr: string, timezone: string): string {
    const date = new Date(`${dateStr}T12:00:00`);
    
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset'
    });
    
    const parts = formatter.formatToParts(date);
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    
    if (tzPart && tzPart.value) {
      const match = tzPart.value.match(/GMT([+-]\d{2}:\d{2})/);
      if (match) {
        return match[1];
      }
    }
    
    // Fallback
    return '-08:00';
  }

  /**
   * Parse time string to minutes since midnight
   */
  private parseTimeToMinutes(timeStr: string): number {
    const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) throw new Error(`Invalid time format: ${timeStr}`);
    
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const ampm = match[3].toUpperCase();
    
    if (ampm === 'PM' && hours < 12) hours += 12;
    else if (ampm === 'AM' && hours === 12) hours = 0;
    
    return hours * 60 + minutes;
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
}