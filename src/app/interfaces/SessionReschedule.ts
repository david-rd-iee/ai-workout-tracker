export interface SessionRescheduleRequest {
  originalBookingId: string;
  newBookingId?: string;
  trainerId: string;
  clientId: string;
  originalDate: string;
  originalTime: string;
  originalStartTimeUTC?: string;
  newDate: string;
  newTime: string;
  newStartTimeUTC?: string;
  timezone?: string;
  reason: string;
  status: 'pending' | 'accepted' | 'rejected';
  requestedBy: 'trainer' | 'client';
  createdAt: string;
}
