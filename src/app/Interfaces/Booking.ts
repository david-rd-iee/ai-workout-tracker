export interface BookingData {
  trainerId: string;
  clientId: string;
  startTimeUTC: string;  // UTC ISO string (e.g., "2025-12-31T23:15:00.000Z")
  endTimeUTC: string;    // UTC ISO string
  timezone: string;      // IANA timezone (e.g., "America/Los_Angeles")
  duration: number;
  status: 'confirmed' | 'cancelled' | 'pending' | 'completed';
  sessionType: 'online' | 'in-person';
  location?: string;
  meetingLink?: string;
  price?: number;        // Session price in dollars
  createdAt: Date;
  clientFirstName?: string;
  clientLastName?: string;
  trainerFirstName?: string;
  trainerLastName?: string;
}