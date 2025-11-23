export interface SessionRescheduleRequest {
  originalBookingId: string;
  newBookingId?: string;
  trainerId: string;
  clientId: string;
  originalDate: string;
  originalTime: string;
  newDate: string;
  newTime: string;
  reason: string;
  status: 'pending' | 'accepted' | 'rejected';
  requestedBy: 'trainer' | 'client';
  createdAt: string;
}
