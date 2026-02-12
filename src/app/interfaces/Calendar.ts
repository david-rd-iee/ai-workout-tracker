export interface TimeSlot {
  time: string;
  available: boolean;
  booked: boolean;
}

export interface TrainerAvailability {
  trainerId: string;
  date: string; // ISO date string (YYYY-MM-DD)
  timeSlots: TimeSlot[];
}

export interface BookingRequest {
  trainerId: string;
  clientId: string;
  date: string;
  time: string;
  endTime?: string;
  duration?: number; // Duration in minutes
  price?: number; // Session price in dollars
  status: 'pending' | 'confirmed' | 'cancelled';
  createdAt: Date;
}
