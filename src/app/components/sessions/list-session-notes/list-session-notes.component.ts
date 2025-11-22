import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonAvatar, IonIcon, IonSkeletonText } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { timeOutline, personOutline } from 'ionicons/icons';
import { Router } from '@angular/router';
import { UserService } from '../../../services/account/user.service';
import { trainerProfile } from '../../../Interfaces/Profiles/Trainer';
import { clientProfile } from '../../../Interfaces/Profiles/Client';
import { SessionNote } from '../../../Interfaces/session-notes.interface';

export interface SessionNoteData {
  id: string;
  trainerId: string;
  clientId: string;
  date: string;        // YYYY-MM-DD format for navigation
  dateObj: Date;       // Date object for display formatting
  name: string;
  text?: string;
  otherPartyName?: string;
  otherPartyImage?: string;
  otherPartyType?: string;
  isProfileLoading?: boolean;
}

@Component({
  selector: 'app-list-session-notes',
  templateUrl: './list-session-notes.component.html',
  styleUrls: ['./list-session-notes.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonAvatar,
    IonIcon,
    IonSkeletonText
  ]
})
export class ListSessionNotesComponent implements OnInit {
  @Input() sessionNotes: SessionNote[] = [];
  @Input() isLoading: boolean = false;
  @Input() noNotesFound: boolean = false;
  @Input() userType: 'trainer' | 'client' = 'client';
  @Input() bookedSessionDates: string[] = []; // Dates that already have booked sessions
  
  // Cache for user profiles to avoid redundant calls
  private profileCache: { [key: string]: trainerProfile | clientProfile } = {};
  
  // Processed notes after filtering and transforming
  processedNotes: SessionNoteData[] = [];

  constructor(
    private router: Router,
    private userService: UserService
  ) { 
    addIcons({
      timeOutline,
      personOutline
    });
  }

  ngOnInit() {
    // No initialization needed - we'll process notes when they change
  }
  
  // Store previous notes to avoid duplicate processing
  private previousNotes: string = '';
  
  ngOnChanges() {
    if (this.sessionNotes && this.sessionNotes.length > 0) {
      // Create a hash of the current notes to compare with previous
      const notesHash = JSON.stringify(this.sessionNotes.map(n => n.id));
      
      // Only process if the notes have changed
      if (notesHash !== this.previousNotes) {
        this.previousNotes = notesHash;
        this.processNotes();
      }
    } else {
      this.processedNotes = [];
    }
  }

  /**
   * Process the input session notes: filter out notes for days with booked sessions,
   * and transform to SessionNoteData format
   */
  private processNotes() {
    // Clear profile cache when processing new notes to avoid stale data
    this.profileCache = {};
    
    // Filter out notes for days that already have booked sessions
    const filteredNotes = this.sessionNotes.filter(note => {
      const noteDate = new Date(note.datetime).toISOString().split('T')[0];
      return !this.bookedSessionDates.includes(noteDate);
    });
    
    // Transform notes to SessionNoteData format
    const transformedNotes: SessionNoteData[] = filteredNotes.map(note => {
      // Get the raw datetime string from the note
      const rawDatetime = note.datetime;
      
      // Extract just the date part (YYYY-MM-DD) directly from the string
      // This avoids any timezone conversion issues
      const datePart = rawDatetime.split('T')[0];
      
      // Create a fixed date object for display purposes
      // Use a fixed time (noon) to avoid timezone issues
      const [year, month, day] = datePart.split('-').map(Number);
      
      // Create a date object with the local timezone but fixed at noon
      // This ensures the date displayed is the same regardless of timezone
      const dateObj = new Date(year, month - 1, day, 12, 0, 0);
      
      return {
        id: note.id,
        trainerId: note.trainerId,
        clientId: note.clientId,
        date: datePart, // Store only the date part for navigation
        dateObj: dateObj, // Use a Date object for display formatting
        name: note.name,
        text: note.text,
        isProfileLoading: true
      };
    });
    
    // Sort notes by date (newest first)
    transformedNotes.sort((a, b) => {
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
    
    this.processedNotes = transformedNotes;
    
    // Only load profiles if we have notes to display
    if (this.processedNotes.length > 0) {
      this.loadProfilesForNotes();
    } else {
      this.noNotesFound = true;
    }
  }

  /**
   * Load profile information for each note
   */
  private loadProfilesForNotes() {
    this.processedNotes.forEach((note, index) => {
      const otherPartyId = this.userType === 'client' ? note.trainerId : note.clientId;
      const otherPartyType = this.userType === 'client' ? 'trainer' : 'client';
      
      // Check if we already have this profile in cache
      if (this.profileCache[otherPartyId]) {
        this.updateNoteWithProfile(index, this.profileCache[otherPartyId], otherPartyType);
        return;
      }
      
      // Otherwise, load the profile
      this.userService.getUserProfileDirectly(otherPartyId, otherPartyType).then(profile => {
        if (profile) {
          this.profileCache[otherPartyId] = profile;
          this.updateNoteWithProfile(index, profile, otherPartyType);
        }
      });
    });
  }

  /**
   * Update a note with profile information
   */
  private updateNoteWithProfile(index: number, profile: trainerProfile | clientProfile, type: string) {
    if (index >= 0 && index < this.processedNotes.length) {
      this.processedNotes[index] = {
        ...this.processedNotes[index],
        otherPartyName: profile.firstName + ' ' + profile.lastName,
        otherPartyImage: profile.profileImage || '',
        otherPartyType: type,
        isProfileLoading: false
      };
    }
  }

  /**
   * View session note details
   * Navigate to the notes page with the appropriate date selected
   */
  viewNoteDetails(note: SessionNoteData) {
    // The date is already in YYYY-MM-DD format, so we can use it directly
    const formattedDate = note.date;
    
    // Determine the receiver ID based on user type
    const receiverId = this.userType === 'client' ? note.trainerId : note.clientId;
    
    // Navigate to the notes page with the date and receiver ID
    this.router.navigate(['/notes', receiverId], { 
      queryParams: { 
        date: formattedDate
      }
    });
  }
}
