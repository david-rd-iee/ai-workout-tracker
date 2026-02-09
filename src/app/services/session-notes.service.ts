import { Injectable, inject } from '@angular/core';
import { Firestore, collection, doc, setDoc, getDoc, getDocs, query, where, orderBy, deleteDoc, updateDoc, onSnapshot, QuerySnapshot, DocumentData, QueryDocumentSnapshot } from '@angular/fire/firestore';
import { Storage, ref, uploadBytes, getDownloadURL, deleteObject } from '@angular/fire/storage';
import { AccountService } from './account/account.service';
import { FileUploadService } from './file-upload.service';
import { BehaviorSubject, Observable, from, map, of, switchMap, catchError, throwError } from 'rxjs';
import { SessionNote, SessionNoteAttachment } from '../Interfaces/session-notes.interface';

@Injectable({
  providedIn: 'root'
})
export class SessionNotesService {
  private firestore = inject(Firestore);
  private storage = inject(Storage);
  private accountService = inject(AccountService);
  private fileUploadService = inject(FileUploadService);
  
  // State management
  private _currentMonthNotes = new BehaviorSubject<SessionNote[]>([]);
  private _selectedDayNotes = new BehaviorSubject<SessionNote[]>([]);
  private _isLoading = new BehaviorSubject<boolean>(false);
  
  // Expose observables
  public currentMonthNotes$ = this._currentMonthNotes.asObservable();
  public selectedDayNotes$ = this._selectedDayNotes.asObservable();
  public isLoading$ = this._isLoading.asObservable();
  
  constructor() { }
  
  /**
   * Create a new session note
   * @returns The complete SessionNote object that was created
   */
  async createSessionNote(note: Omit<SessionNote, 'id' | 'createdAt' | 'updatedAt' | 'attachmentIds'>): Promise<SessionNote> {
    const notesCollection = collection(this.firestore, 'sessionNotes');
    const noteId = doc(notesCollection).id;
    const uid = this.accountService.getCredentials()()?.uid;

    if (!uid) {
      throw new Error('User not authenticated');
    }

    const newNote: SessionNote = {
      ...note,
      id: noteId,
      attachmentIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      trainerId: note.trainerId || uid
    };

    await setDoc(doc(notesCollection, noteId), newNote);
    
    // Refresh the current month's notes if necessary
    this.refreshCurrentMonthNotes(new Date(note.datetime));
    
    return newNote;
  }
  
  /**
   * Update an existing session note
   */
  async updateSessionNote(noteId: string, updates: Partial<Omit<SessionNote, 'id' | 'createdAt'>>): Promise<void> {
    const noteRef = doc(this.firestore, 'sessionNotes', noteId);
    
    const updatedData = {
      ...updates,
      updatedAt: new Date().toISOString()
    };

    return updateDoc(noteRef, updatedData);
  }
  
  /**
   * Delete a session note and all its attachments
   */
  async deleteSessionNote(noteId: string): Promise<void> {
    try {
      // First, get all attachments associated with this note
      const filesCollection = collection(this.firestore, 'sessionNoteAttachments');
      const filesQuery = query(filesCollection, where('noteId', '==', noteId));
      const filesSnapshot = await getDocs(filesQuery);
      
      // Delete each attachment (both from storage and Firestore)
      const fileDeletionPromises = filesSnapshot.docs.map(fileDoc => {
        const fileData = fileDoc.data() as SessionNoteAttachment;
        return this.deleteAttachment(fileData.id, fileData.filePath);
      });
      
      // Wait for all file deletions to complete
      await Promise.all(fileDeletionPromises);
      
      // Delete the note itself from the database
      const noteRef = doc(this.firestore, 'sessionNotes', noteId);
      await deleteDoc(noteRef);
      
      // Update the local state by removing the deleted note from both BehaviorSubjects
      const currentMonthNotes = this._currentMonthNotes.getValue().filter(note => note.id !== noteId);
      this._currentMonthNotes.next(currentMonthNotes);
      
      const selectedDayNotes = this._selectedDayNotes.getValue().filter(note => note.id !== noteId);
      this._selectedDayNotes.next(selectedDayNotes);
    } catch (error) {
      console.error('Error deleting session note and attachments:', error);
      throw error;
    }
  }
  
  /**
   * Get a specific session note by ID
   */
  getSessionNoteById(noteId: string): Observable<SessionNote | null> {
    const noteRef = doc(this.firestore, 'sessionNotes', noteId);
    
    return from(getDoc(noteRef)).pipe(
      map(docSnap => {
        if (docSnap.exists()) {
          return docSnap.data() as SessionNote;
        }
        return null;
      })
    );
  }
  
  /**
   * Get session notes for a specific month
   * @param date Any date within the target month
   */
  getSessionNotesForMonth(date: Date): Observable<SessionNote[]> {
    this._isLoading.next(true);
    
    const year = date.getFullYear();
    const month = date.getMonth();
    
    // Calculate start and end dates for the month
    const startDate = new Date(year, month, 1).toISOString();
    const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999).toISOString();
    
    const uid = this.accountService.getCredentials()()?.uid;
    if (!uid) {
      throw new Error('User not authenticated');
    }
    
    const notesCollection = collection(this.firestore, 'sessionNotes');
    
    // Try a different approach - query all notes in the date range
    // and filter client-side
    const notesQuery = query(
      notesCollection,
      where('datetime', '>=', startDate),
      where('datetime', '<=', endDate)
    );
    
    // Fetch notes for the month
    
    return from(getDocs(notesQuery)).pipe(
      map(snapshot => {
        const notes: SessionNote[] = [];
        snapshot.forEach(doc => {
          const data = doc.data() as SessionNote;
          
          // Filter notes based on user role (trainer or client)
          if (data.trainerId === uid || data.clientId === uid) {
            notes.push({ ...data, id: doc.id });
          }
        });
        
        // Sort notes by date (newest first)
        notes.sort((a, b) => {
          return new Date(b.datetime).getTime() - new Date(a.datetime).getTime();
        });
        
        this._currentMonthNotes.next(notes);
        this._isLoading.next(false);
        return notes;
      }),
      catchError(error => {
        console.error('Error fetching session notes for month:', error);
        this._isLoading.next(false);
        return of([]);
      })
    );
  }
  
  /**
   * Get session notes for a specific day
   * @param date The target date
   */
  getSessionNotesForDay(date: Date): Observable<SessionNote[]> {
    // Create start and end of the day
    const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
    const endOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).toISOString();
    
    const uid = this.accountService.getCredentials()()?.uid;
    if (!uid) {
      throw new Error('User not authenticated');
    }
    
    const notesCollection = collection(this.firestore, 'sessionNotes');
    
    // Query notes for the current user (either as trainer or client) within the date range
    const notesQuery = query(
      notesCollection,
      where('datetime', '>=', startOfDay),
      where('datetime', '<=', endOfDay),
      orderBy('datetime', 'asc')
    );
    
    return from(getDocs(notesQuery)).pipe(
      map(snapshot => {
        const notes: SessionNote[] = [];
        snapshot.forEach(doc => {
          const data = doc.data() as SessionNote;
          // Filter notes based on user role (trainer or client)
          if (data.trainerId === uid || data.clientId === uid) {
            notes.push({ ...data, id: doc.id });
          }
        });
        
        this._selectedDayNotes.next(notes);
        return notes;
      }),
      catchError(error => {
        console.error('Error fetching session notes for day:', error);
        return of([]);
      })
    );
  }
  
  /**
   * Set the selected day and load notes for that day
   * @param date The selected date
   */
  setSelectedDay(date: Date): void {
    // Filter notes from the current month that match the selected day
    const currentNotes = this._currentMonthNotes.getValue();
    
    if (currentNotes.length > 0) {
      // Filter notes for the selected day
      const selectedDay = new Date(date);
      selectedDay.setHours(0, 0, 0, 0);
      const nextDay = new Date(selectedDay);
      nextDay.setDate(nextDay.getDate() + 1);
      
      const dayNotes = currentNotes.filter(note => {
        const noteDate = new Date(note.datetime);
        return noteDate >= selectedDay && noteDate < nextDay;
      });
      
      this._selectedDayNotes.next(dayNotes);
    } else {
      // If no notes for the month, fetch specifically for this day
      this.getSessionNotesForDay(date).subscribe();
    }
  }
  
  /**
   * Refresh the current month's notes
   * @param date Any date within the target month
   */
  refreshCurrentMonthNotes(date: Date): void {
    this.getSessionNotesForMonth(date).subscribe();
  }
  
  /**
   * Upload an attachment for a session note
   */
  async uploadAttachment(noteId: string, file: File): Promise<SessionNoteAttachment> {
    const uid = this.accountService.getCredentials()()?.uid;
    
    if (!uid) {
      throw new Error('User not authenticated');
    }

    // Security checks
    await this.validateFile(file);

    // Create a unique file path
    const fileId = doc(collection(this.firestore, 'sessionNoteAttachments')).id;
    const filePath = `sessionNotes/${noteId}/${fileId}_${file.name}`;
    
    // Use FileUploadService for upload (iOS-compliant)
    const downloadUrl = await this.fileUploadService.uploadFile(filePath, file);
    
    // Create file metadata
    const fileData: SessionNoteAttachment = {
      id: fileId,
      noteId,
      fileName: file.name,
      fileUrl: downloadUrl,
      fileType: file.type,
      filePath: filePath, // Store the path for later deletion
      uploadedAt: new Date().toISOString(),
      uploadedBy: uid
    };
    
    // Save file metadata to Firestore
    await setDoc(doc(this.firestore, 'sessionNoteAttachments', fileId), fileData);
    
    // Update the note's attachmentIds array
    const noteRef = doc(this.firestore, 'sessionNotes', noteId);
    const noteSnap = await getDoc(noteRef);
    
    if (noteSnap.exists()) {
      const noteData = noteSnap.data() as SessionNote;
      const updatedAttachmentIds = [...(noteData.attachmentIds || []), fileId];
      
      await updateDoc(noteRef, {
        attachmentIds: updatedAttachmentIds,
        updatedAt: new Date().toISOString()
      });
    }
    
    return fileData;
  }
  
  /**
   * Delete an attachment from a session note
   */
  async deleteAttachment(attachmentId: string, filePath?: string): Promise<void> {
    const uid = this.accountService.getCredentials()()?.uid;
    
    if (!uid) {
      throw new Error('User not authenticated');
    }
    
    try {
      // Get the attachment data to find its associated note
      const attachmentRef = doc(this.firestore, 'sessionNoteAttachments', attachmentId);
      const attachmentSnap = await getDoc(attachmentRef);
      let noteId: string | null = null;
      
      if (attachmentSnap.exists()) {
        const attachmentData = attachmentSnap.data() as SessionNoteAttachment;
        noteId = attachmentData.noteId;
        
        // Delete the file from storage if we have a path
        if (attachmentData.filePath || filePath) {
          const storagePath = attachmentData.filePath || filePath;
          const storageRef = ref(this.storage, storagePath);
          await deleteObject(storageRef).catch(err => {
            console.warn('File may not exist in storage:', err);
            // Continue with deletion even if storage deletion fails
          });
        }
      }
      
      // Delete the attachment metadata from Firestore
      await deleteDoc(attachmentRef);
      
      // Update the note's attachmentIds array if we found a noteId
      if (noteId) {
        const noteRef = doc(this.firestore, 'sessionNotes', noteId);
        const noteSnap = await getDoc(noteRef);
        
        if (noteSnap.exists()) {
          const noteData = noteSnap.data() as SessionNote;
          const updatedAttachmentIds = noteData.attachmentIds.filter(id => id !== attachmentId);
          
          await updateDoc(noteRef, {
            attachmentIds: updatedAttachmentIds,
            updatedAt: new Date().toISOString()
          });
        }
      }
    } catch (error) {
      console.error('Error deleting attachment:', error);
      throw error;
    }
  }
  
  /**
   * Get attachments for a specific session note
   */
  getAttachments(noteId: string): Observable<SessionNoteAttachment[]> {
    const attachmentsCollection = collection(this.firestore, 'sessionNoteAttachments');
    const attachmentsQuery = query(
      attachmentsCollection,
      where('noteId', '==', noteId),
      orderBy('uploadedAt', 'desc')
    );

    return from(getDocs(attachmentsQuery)).pipe(
      map(snapshot => {
        const attachments: SessionNoteAttachment[] = [];
        snapshot.forEach(doc => {
          attachments.push(doc.data() as SessionNoteAttachment);
        });
        return attachments;
      }),
      catchError(error => {
        console.error('Error fetching attachments:', error);
        return of([]);
      })
    );
  }
  
  /**
   * Validate file for security before upload
   * @param file The file to validate
   * @throws Error if file validation fails
   */
  private async validateFile(file: File): Promise<void> {
    // Check file size (limit to 10MB)
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB in bytes
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File size exceeds the maximum allowed size of 10MB. Current size: ${(file.size / (1024 * 1024)).toFixed(2)}MB`);
    }
    
    // Check file type
    const allowedTypes = [
      // Images
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
      // Documents
      'application/pdf', 'application/msword', 
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
      'text/plain', 'text/csv'
    ];
    
    if (!allowedTypes.includes(file.type)) {
      throw new Error(`File type '${file.type}' is not allowed. Please upload an image or document file.`);
    }
  }
}