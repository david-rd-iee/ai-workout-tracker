import { Component, OnInit, OnDestroy, inject, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonButton, IonIcon, IonDatetime, IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonItem, IonSpinner, IonInput, IonTextarea, AlertController, ModalController, Platform } from '@ionic/angular/standalone';
import { SessionNote, SessionNoteAttachment } from 'src/app/Interfaces/session-notes.interface';
import { SessionNotesService } from 'src/app/services/session-notes.service';
import { AccountService } from 'src/app/services/account/account.service';
import { AttachmentService } from 'src/app/services/attachment.service';
import { Subscription } from 'rxjs';
import { addIcons } from 'ionicons';
import { add, addOutline, camera, cameraOutline, documentAttachOutline, trash, trashOutline, createOutline, downloadOutline, ellipse, document, documentText, documentTextOutline, closeCircle, imageOutline, gridOutline, informationCircleOutline } from 'ionicons/icons';
import { FilePreviewComponent } from 'src/app/components/file-preview/file-preview.component';

@Component({
  selector: 'app-session-notes',
  templateUrl: './session-notes.component.html',
  styleUrls: ['./session-notes.component.scss'],
  imports: [
    CommonModule, 
    FormsModule,
    IonButton, 
    IonIcon, 
    IonDatetime, 
    IonCard, 
    IonCardHeader, 
    IonCardTitle, 
    IonCardContent,
    IonItem,
    IonSpinner,
    IonInput,
    IonTextarea,
    FilePreviewComponent
  ]
})
export class SessionNotesComponent implements OnInit, OnDestroy {
  // Date handling
  @Input() selectedDate: Date = new Date();
  currentMonth: Date = new Date();
  
  // Notes data
  monthNotes: SessionNote[] = [];
  selectedDayNotes: SessionNote[] = [];
  noteAttachments: Map<string, SessionNoteAttachment[]> = new Map<string, SessionNoteAttachment[]>();
  loadingAttachments: Map<string, boolean> = new Map<string, boolean>();
  
  // UI state
  isLoading = true;
  isCreatingNote = false;
  newNote: Partial<SessionNote> = {};
  isTrainer = false;
  uid: string | null = null;
  
  // Temporary attachments for new notes
  tempAttachments: { file: File }[] = [];
  
  // Input properties
  @Input() clientId: string | null = null;
  @Input() trainerId: string | null = null;
  
  // Subscriptions
  private subscriptions: Subscription[] = [];
  
  // Services
  private sessionNotesService = inject(SessionNotesService);
  private accountService = inject(AccountService);
  private attachmentService = inject(AttachmentService);
  private alertCtrl = inject(AlertController);
  private modalCtrl = inject(ModalController);
  private platform = inject(Platform);
  
  constructor() {
    addIcons({
      add,
      addOutline,
      camera,
      cameraOutline,
      document,
      documentAttachOutline,
      documentText,
      documentTextOutline,
      trash,
      trashOutline,
      createOutline,
      downloadOutline,
      ellipse,
      closeCircle,
      imageOutline,
      gridOutline,
      informationCircleOutline
    });
  }
  
  ngOnInit() {
    // Get current user info
    const credentials = this.accountService.getCredentials()();
    if (credentials?.uid) {
      this.uid = credentials.uid;
      
      // Determine if user is a trainer
      this.isTrainer = this.uid === this.trainerId;
      
      // Subscribe to loading state
      this.subscriptions.push(
        this.sessionNotesService.isLoading$.subscribe(isLoading => {
          this.isLoading = isLoading;
        })
      );
      
      // Subscribe to current month notes
      this.subscriptions.push(
        this.sessionNotesService.currentMonthNotes$.subscribe(notes => {
          this.monthNotes = notes;
        })
      );

      // Subscribe to selected day notes
      this.subscriptions.push(
        this.sessionNotesService.selectedDayNotes$.subscribe(notes => {
          this.selectedDayNotes = notes;
          
          // Load attachments for each note
          notes.forEach(note => {
            this.loadAttachmentsForNote(note.id);
          });
        })
      );

      // If selectedDate is provided via @Input, use it to set the current month
      if (this.selectedDate) {
        this.currentMonth = new Date(
          this.selectedDate.getFullYear(),
          this.selectedDate.getMonth(),
          1
        );
      }
      
      // Load notes for the current month
      this.loadMonthNotes(this.currentMonth);
      
      // If selectedDate is provided, set it as the selected day
      if (this.selectedDate) {
        this.sessionNotesService.setSelectedDay(this.selectedDate);
      }
    }
  }
  
  ngOnDestroy() {
    // Clean up subscriptions
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }
  
  /**
   * Load notes for the selected month
   */
  loadMonthNotes(date: Date) {
    this.currentMonth = new Date(date);
    this.sessionNotesService.refreshCurrentMonthNotes(this.currentMonth);
  }
  
  /**
   * Handle date selection change
   */
  onDateChange(event: any) {
    const selectedDateStr = event.detail.value;
    if (selectedDateStr) {
      this.selectedDate = new Date(selectedDateStr);
      this.sessionNotesService.setSelectedDay(this.selectedDate);
    }
  }
  
  /**
   * Handle month change in the calendar
   */
  onMonthChange(event: any) {
    const monthValue = event.detail.value;
    if (monthValue) {
      const newMonth = new Date(monthValue);
      this.loadMonthNotes(newMonth);
    }
  }
  
  /**
   * Get highlighted dates for the calendar
   * Returns an array of dates that have notes
   */
  getHighlightedDates() {
    if (!this.monthNotes || this.monthNotes.length === 0) {
      return [];
    }
    
    // Create a map of dates that have notes
    const highlightedDates = this.monthNotes.map(note => {
      const noteDate = new Date(note.datetime);
      return {
        date: noteDate.toISOString().split('T')[0],
        textColor: '#4a90e2'
      };
    });
    
    return highlightedDates;
  }
  
  /**
   * Load attachments for a specific note
   */
  loadAttachmentsForNote(noteId: string) {
    this.loadingAttachments.set(noteId, true);
    
    this.sessionNotesService.getAttachments(noteId).subscribe(
      attachments => {
        this.noteAttachments.set(noteId, attachments);
        this.loadingAttachments.set(noteId, false);
      },
      error => {
        console.error('Error loading attachments:', error);
        this.loadingAttachments.set(noteId, false);
      }
    );
  }
  
  /**
   * Add a temporary attachment to a new note
   */
  async addTempAttachment() {
    this.attachmentService.showAttachmentOptions(
      // Take photo handler
      async () => {
        const file = await this.attachmentService.takePicture();
        if (file) {
          this.tempAttachments.push({ file });
          await this.attachmentService.showToast('Photo added', 1500, 'success');
        }
      },
      // Choose file handler
      async () => {
        const file = await this.attachmentService.selectDocumentFile();
        if (file) {
          this.tempAttachments.push({ file });
          await this.attachmentService.showToast('File added', 1500, 'success');
        }
      },
      // Photo library handler
      async () => {
        const file = await this.attachmentService.selectFromPhotoLibrary();
        if (file) {
          this.tempAttachments.push({ file });
          await this.attachmentService.showToast('Photo added', 1500, 'success');
        }
      }
    );
  }
  
  /**
   * Remove a temporary attachment
   */
  removeTempAttachment(index: number) {
    this.tempAttachments.splice(index, 1);
  }
  
  /**
   * Get the appropriate icon for a file type
   */
  getFileIcon(mimeType: string): string {
    return this.attachmentService.getFileIcon(mimeType);
  }
  
  /**
   * Create a new session note
   */
  async createNote() {
    if (!this.newNote.name || !this.newNote.text || !this.clientId || !this.trainerId) {
      await this.attachmentService.showToast('Please fill in all required fields', 2000, 'warning');
      return;
    }
    
    try {
      // Extract just the date part (YYYY-MM-DD) without time to avoid timezone issues
      const dateOnly = this.selectedDate.toISOString().split('T')[0] + 'T12:00:00.000Z';
      
      const note: Omit<SessionNote, 'id' | 'createdAt' | 'updatedAt' | 'attachmentIds'> = {
        datetime: dateOnly, // Store date at noon UTC to avoid timezone issues
        clientId: this.clientId,
        trainerId: this.trainerId,
        name: this.newNote.name!,
        text: this.newNote.text!
      };
      
      // Create the note first
      const createdNote = await this.sessionNotesService.createSessionNote(note);
      
      // Then upload any temporary attachments
      if (this.tempAttachments.length > 0) {
        // Show loading toast for attachments
        const loadingToast = await this.attachmentService.showToast('Uploading attachments...', 0, 'primary');
        
        try {
          const uploadPromises = this.tempAttachments.map(attachment => 
            this.sessionNotesService.uploadAttachment(createdNote.id, attachment.file)
          );
          
          await Promise.all(uploadPromises);
          await loadingToast.dismiss();
        } catch (uploadError) {
          await loadingToast.dismiss();
          await this.attachmentService.showToast('Error uploading attachments', 2000, 'danger');
          console.error('Error uploading attachments:', uploadError);
        }
      }
      
      // Reset form
      this.isCreatingNote = false;
      this.newNote = {};
      this.tempAttachments = [];
      
      await this.attachmentService.showToast('Session note created successfully', 2000, 'success');
      
      // Refresh the selected day's notes
      this.sessionNotesService.setSelectedDay(this.selectedDate);
    } catch (error) {
      console.error('Error creating session note:', error);
      await this.attachmentService.showToast('Error creating session note', 2000, 'danger');
    }
  }
  
  /**
   * Delete a session note
   */
  async deleteNote(note: SessionNote) {
    const alert = await this.alertCtrl.create({
      header: 'Confirm Delete',
      message: 'Are you sure you want to delete this session note? This action cannot be undone.',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            try {
              // Remove any attachments from the local map for immediate UI feedback
              this.noteAttachments.delete(note.id);
              
              // Perform the deletion in the database
              await this.sessionNotesService.deleteSessionNote(note.id);
              
              await this.attachmentService.showToast('Session note deleted successfully', 2000, 'success');
            } catch (error) {
              console.error('Error deleting session note:', error);
              
              // If deletion fails, refresh to restore the correct state
              this.sessionNotesService.setSelectedDay(this.selectedDate);
              this.sessionNotesService.refreshCurrentMonthNotes(this.currentMonth);
              
              await this.attachmentService.showToast('Error deleting session note', 2000, 'danger');
            }
          }
        }
      ]
    });
    
    await alert.present();
  }
  
  /**
   * Add a file attachment to a note
   */
  async addAttachment(noteId: string) {
    this.attachmentService.showAttachmentOptions(
      // Take photo handler
      async () => {
        const file = await this.attachmentService.takePicture();
        if (file) {
          await this.uploadAttachment(noteId, file);
        }
      },
      // Choose file handler
      async () => {
        const file = await this.attachmentService.selectDocumentFile();
        if (file) {
          await this.uploadAttachment(noteId, file);
        }
      },
      // Photo library handler
      async () => {
        const file = await this.attachmentService.selectFromPhotoLibrary();
        if (file) {
          await this.uploadAttachment(noteId, file);
        }
      }
    );
  }
  
  /**
   * Upload an attachment to a note
   */
  async uploadAttachment(noteId: string, file: File) {
    try {
      const toast = await this.attachmentService.showToast('Uploading file...', 0);
      
      await this.sessionNotesService.uploadAttachment(noteId, file);
      
      await toast.dismiss();
      
      await this.attachmentService.showToast('File uploaded successfully', 2000, 'success');
      
      // Refresh attachments for the note
      this.loadAttachmentsForNote(noteId);
    } catch (error) {
      console.error('Error uploading file:', error);
      await this.attachmentService.showToast(
        `Error uploading file: ${error instanceof Error ? error.message : 'Unknown error'}`, 
        3000, 
        'danger'
      );
    }
  }
  
  /**
   * Delete an attachment from a note
   */
  async deleteAttachment(attachmentId: string, noteId: string, filePath?: string) {
    try {
      await this.sessionNotesService.deleteAttachment(attachmentId, filePath);
      
      await this.attachmentService.showToast('Attachment deleted successfully', 2000, 'success');
      
      // Refresh attachments for the note
      this.loadAttachmentsForNote(noteId);
    } catch (error) {
      console.error('Error deleting attachment:', error);
      await this.attachmentService.showToast('Error deleting attachment', 2000, 'danger');
    }
  }
  
  /**
   * Set the client ID for creating a new note
   */
  setClientId(clientId: string) {
    this.clientId = clientId;
  }
  
  /**
   * Format date for display
   */
  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  
  /**
   * Cancel creating a new note
   */
  cancelCreateNote() {
    this.isCreatingNote = false;
    this.newNote = {};
    this.tempAttachments = [];
  }
}
