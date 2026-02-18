import { Component, Input, OnInit, Signal, Output, EventEmitter, OnChanges } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { IonAvatar, IonIcon, IonSkeletonText, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { timeOutline, personOutline, closeOutline } from 'ionicons/icons';
// import { AgreementModalComponent } from '../../agreements/agreement-modal/agreement-modal.component';
import { Router } from '@angular/router';
import { UserService } from '../../../services/account/user.service';
import { trainerProfile } from '../../../Interfaces/Profiles/Trainer';
import { clientProfile } from '../../../Interfaces/Profiles/client';
import { SessionNotesService } from '../../../services/session-notes.service';
import { SessionNote } from '../../../Interfaces/session-notes.interface';
import { ListSessionNotesComponent } from '../list-session-notes/list-session-notes.component';
import { ModalSessionCancelComponent } from '../modal-session-cancel/modal-session-cancel.component';

export interface SessionData {
  id: string;
  trainerId: string;
  clientId: string;
  date: string;
  time: string;
  status?: string;
  endTime?: string;
  duration?: number; 
  otherPartyName?: string;
  otherPartyImage?: string;
  otherPartyType?: string;
  isProfileLoading?: boolean;
}

@Component({
  selector: 'app-list-sessions',
  templateUrl: './list-sessions.component.html',
  styleUrls: ['./list-sessions.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonAvatar,
    IonIcon,
    IonSkeletonText,
    DatePipe,
    ListSessionNotesComponent
  ]
})
export class ListSessionsComponent implements OnInit, OnChanges {
  @Input() sessions: SessionData[] = [];
  @Input() isLoading: boolean = false;
  @Input() noSessionsFound: boolean = false;
  @Input() userType: 'trainer' | 'client' = 'client';
  @Output() sessionChanged = new EventEmitter<{action: string, sessionId: string}>();
  
  // Cache for user profiles to avoid redundant calls
  private profileCache: { [key: string]: trainerProfile | clientProfile } = {};
  
  // Processed sessions after sorting and merging
  processedSessions: SessionData[] = [];

  // Session notes related properties
  sessionNotes: SessionNote[] = [];
  isLoadingNotes: boolean = false;
  noNotesFound: boolean = false;
  bookedSessionDates: string[] = []; // Dates that already have booked sessions

  constructor(
    private router: Router,
    private userService: UserService,
    private sessionNotesService: SessionNotesService,
    private modalController: ModalController
  ) { 
    addIcons({
      timeOutline,
      personOutline,
      closeOutline
    });
  }

  ngOnInit() {
    // Load session notes for the current month
    this.loadSessionNotes();
  }
  
  private previousSessions: string = '';
  
  ngOnChanges() {
    if (this.sessions && this.sessions.length > 0 && !this.isLoading) {
      this.processSessions();
      this.extractBookedSessionDates();
    } else if (!this.sessions || this.sessions.length === 0) {
      this.processedSessions = [];
      this.bookedSessionDates = [];
    }
  }
  
  private loadSessionNotes() {
    this.isLoadingNotes = true;
    const currentDate = new Date();
    
    this.sessionNotesService.getSessionNotesForMonth(currentDate).subscribe((notes: SessionNote[]) => {
      this.sessionNotes = notes;
      this.noNotesFound = notes.length === 0;
      this.isLoadingNotes = false;
      
      // Extract booked session dates after loading notes
      if (this.sessions && this.sessions.length > 0) {
        this.extractBookedSessionDates();
      }
    });
  }
  
  private extractBookedSessionDates() {
    if (!this.sessions || this.sessions.length === 0) {
      this.bookedSessionDates = [];
      return;
    }
    
    // Extract unique dates from sessions
    this.bookedSessionDates = this.sessions.map(session => {
      // Convert date string to ISO date format (YYYY-MM-DD)
      const sessionDate = new Date(session.date);
      return sessionDate.toISOString().split('T')[0];
    }).filter((date, index, self) => {
      // Remove duplicates
      return self.indexOf(date) === index;
    });
  }

  private processSessions() {
    // Filter out any sessions with 'pending_cancellation' or 'cancelled' status
    const filteredSessions = this.sessions.filter(session => {
      return session.status !== 'pending_cancellation' && session.status !== 'cancelled';
    });
    
    // Standardize the sessions - we no longer calculate endTime or duration
    // as these values should now come from the server
    const standardizedSessions = filteredSessions.map(session => {
      // Set default values that will be shown while loading
      const otherPartyName = this.userType === 'client' ? 'Your Trainer' : 'Your Client';
      const otherPartyType = this.userType === 'client' ? 'Trainer' : 'Client';
      
      return {
        ...session,
        otherPartyName: session.otherPartyName || otherPartyName,
        otherPartyType: session.otherPartyType || otherPartyType,
        isProfileLoading: !session.otherPartyName // Only set to loading if we don't have a name yet
      };
    });
    
    // Sort sessions by date, trainer/client, and start time
    standardizedSessions.sort((a, b) => {
      try {
        // Safely handle date comparison
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        
        // Compare by the other party (trainer for clients, client for trainers)
        const aPartyId = this.userType === 'client' ? a.trainerId : a.clientId;
        const bPartyId = this.userType === 'client' ? b.trainerId : b.clientId;
        
        // Safely handle party ID comparison
        if (!aPartyId && !bPartyId) return 0;
        if (!aPartyId) return 1;
        if (!bPartyId) return -1;
        if (aPartyId !== bPartyId) return aPartyId.localeCompare(bPartyId);
        
        // Compare by start time
        const aTimeMinutes = this.timeToMinutes(a.time);
        const bTimeMinutes = this.timeToMinutes(b.time);
        return aTimeMinutes - bTimeMinutes;
      } catch (error) {
        console.error('Error sorting sessions:', error);
        return 0; // Keep original order on error
      }
    });
    
    // Update the processed sessions
    this.processedSessions = standardizedSessions;
    
    // Fetch profiles if we have sessions
    if (standardizedSessions.length > 0) {
      setTimeout(() => {
        this.fetchProfiles();
      }, 100);
    }
  }
  
  private fetchProfiles() {
    // Create a map of unique IDs to fetch to avoid duplicate requests
    const trainerIds = new Set<string>();
    const clientIds = new Set<string>();
    
    // Collect unique IDs
    for (const session of this.processedSessions) {
      if (session.isProfileLoading) {
        if (this.userType === 'client' && session.trainerId) {
          trainerIds.add(session.trainerId);
        } else if (this.userType === 'trainer' && session.clientId) {
          clientIds.add(session.clientId);
        }
      }
    }
    
    // Fetch trainer profiles
    trainerIds.forEach(trainerId => {
      // Check cache first
      const cacheKey = `trainer_${trainerId}`;
      if (this.profileCache[cacheKey]) {
        // Update all sessions with this trainer
        this.updateSessionsWithProfile(trainerId, 'trainer', this.profileCache[cacheKey]);
      } else {
        // Fetch the profile
        this.userService.getUserProfileDirectly(trainerId, 'trainer')
          .then(profile => {
            if (profile) {
              this.profileCache[cacheKey] = profile;
              this.updateSessionsWithProfile(trainerId, 'trainer', profile);
            }
          })
          .catch(error => {
            console.error('Error fetching trainer profile:', error);
          });
      }
    });
    
    // Fetch client profiles
    clientIds.forEach(clientId => {
      // Check cache first
      const cacheKey = `client_${clientId}`;
      if (this.profileCache[cacheKey]) {
        // Update all sessions with this client
        this.updateSessionsWithProfile(clientId, 'client', this.profileCache[cacheKey]);
      } else {
        // Fetch the profile
        this.userService.getUserProfileDirectly(clientId, 'client')
          .then(profile => {
            if (profile) {
              this.profileCache[cacheKey] = profile;
              this.updateSessionsWithProfile(clientId, 'client', profile);
            }
          })
          .catch(error => {
            console.error('Error fetching client profile:', error);
          });
      }
    });
  }
  
  private updateSessionsWithProfile(userId: string, userType: 'trainer' | 'client', profile: trainerProfile | clientProfile) {
    for (const session of this.processedSessions) {
      if ((userType === 'trainer' && session.trainerId === userId) || 
          (userType === 'client' && session.clientId === userId)) {
        const profilepic = (profile as any).profilepic || '';
        console.log('[ListSessions] Updating session with profile:', {
          userId,
          userType,
          profilepic,
          profileData: profile
        });
        session.otherPartyName = `${profile.firstName} ${profile.lastName}`;
        session.otherPartyImage = profilepic;
        session.otherPartyType = userType === 'trainer' ? 'Trainer' : 'Client';
        session.isProfileLoading = false;
      }
    }
  }
  
  private timeToMinutes(timeStr: string): number {
    if (!timeStr) return 0;
    
    try {
      const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      if (!match) {
        // Invalid format but don't log error - just return 0 silently
        return 0;
      }
      
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
    } catch (error) {
      // Silently handle errors without logging
      return 0;
    }
  }

  viewSessionDetails(session: SessionData) {
    if (!session || !session.date) {
      console.error('Session or session date is missing');
      return;
    }
    
    // Format the date properly to avoid timezone issues
    // First, parse the date string (format is likely YYYY-MM-DD)
    const [year, month, day] = session.date.split('-').map(num => parseInt(num, 10));
    
    // Create a date at noon to avoid timezone issues (using noon prevents day shifts)
    const dateObj = new Date(year, month - 1, day, 12, 0, 0);
    const isoDate = dateObj.toISOString();
    
    // Navigate to the appropriate calendar page based on user type
    if (this.userType === 'trainer') {
      // Navigate to trainer calendar with date parameter
      this.router.navigate(['/app/tabs/calender/trainer'], { 
        queryParams: { selectedDate: isoDate }
      });
    } else {
      // Navigate to client calendar with date parameter
      this.router.navigate(['/app/tabs/calender/client'], { 
        queryParams: { selectedDate: isoDate }
      });
    }
  }

  async openCancelModal(session: SessionData, event: Event) {
    // Prevent the click event from propagating to the parent (which would navigate to session details)
    event.stopPropagation();
    
    if (!session) {
      console.error('Session data is missing');
      return;
    }
    
    const modal = await this.modalController.create({
      component: ModalSessionCancelComponent,
      componentProps: {
        session: session
      }
    });
    
    await modal.present();
    
    // Handle the modal dismiss event
    const { data } = await modal.onDidDismiss();
    
    if (data) {
      console.log('Cancel modal dismissed with data:', data);
      
      // Refresh the sessions list when a session is rescheduled or canceled
      if (data.action === 'reschedule' || data.action === 'cancel') {
        // Reset the previous sessions hash to force a refresh
        this.previousSessions = '';
        
        // Emit an event to notify parent components to reload sessions
        this.sessionChanged.emit({ 
          action: data.action, 
          sessionId: session.id 
        });
        
        // Remove the canceled/rescheduled session from the local array
        this.processedSessions = this.processedSessions.filter(s => s.id !== session.id);
        
        // If this was a reschedule, we'll need to reload the sessions to get the new one
        if (data.action === 'reschedule') {
          // The parent component should handle reloading the sessions when it receives the sessionsChanged event
        }
      }
    }
  }
}
