import { Injectable, inject } from '@angular/core';
import { Firestore, collection, doc, setDoc, getDoc, getDocs, query, where, orderBy, deleteDoc, updateDoc, onSnapshot, QuerySnapshot, DocumentData, QueryDocumentSnapshot } from '@angular/fire/firestore';
import { Storage, ref, uploadBytes, getDownloadURL, deleteObject } from '@angular/fire/storage';
import { AccountService } from './account/account.service';
import { FileUploadService } from './file-upload.service';
import { Observable, from, map, of, switchMap, catchError, throwError } from 'rxjs';

export interface Note {
  id: string;
  title: string;
  content: string[];
  createdAt: string;
  updatedAt: string;
  trainerId: string;      // Trainer who created the note
  clientId: string;       // Client the note is for
  showToClient: boolean;  // Whether the client can see this note
  type: 'general' | 'workout';
}

export interface NoteFile {
  id: string;
  noteId: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  filePath?: string; // Path in storage for deletion
  uploadedAt: string;
  uploadedBy: string;
}

@Injectable({
  providedIn: 'root'
})
export class NotesService {
  private firestore = inject(Firestore);
  private storage = inject(Storage);
  private accountService = inject(AccountService);
  private fileUploadService = inject(FileUploadService);

  // No helper method needed as we'll pass the user type directly

  constructor() { }

  /**
   * Create a new note
   * @returns The complete Note object that was created
   */
  async createNote(note: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>): Promise<Note> {
    const notesCollection = collection(this.firestore, 'notes');
    const noteId = doc(notesCollection).id;
    const uid = this.accountService.getCredentials()()?.uid;

    if (!uid) {
      throw new Error('User not authenticated');
    }

    const newNote: Note = {
      ...note,
      id: noteId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      trainerId: note.trainerId || uid
    };

    await setDoc(doc(notesCollection, noteId), newNote);
    return newNote; // Return the complete note object instead of just the ID
  }

  /**
   * Update an existing note
   */
  async updateNote(noteId: string, updates: Partial<Omit<Note, 'id' | 'createdAt'>>): Promise<void> {
    const noteRef = doc(this.firestore, 'notes', noteId);
    
    const updatedData = {
      ...updates,
      updatedAt: new Date().toISOString()
    };

    return updateDoc(noteRef, updatedData);
  }

  /**
   * Delete a note and all its attachments
   */
  async deleteNote(noteId: string): Promise<void> {
    try {
      // First, get all files associated with this note
      const filesCollection = collection(this.firestore, 'noteFiles');
      const filesQuery = query(filesCollection, where('noteId', '==', noteId));
      const filesSnapshot = await getDocs(filesQuery);
      
      // Delete each file (both from storage and Firestore)
      const fileDeletionPromises = filesSnapshot.docs.map(fileDoc => {
        const fileData = fileDoc.data() as NoteFile;
        return this.deleteNoteFile(fileData.id, fileData.filePath);
      });
      
      // Wait for all file deletions to complete
      await Promise.all(fileDeletionPromises);
      
      // Finally, delete the note itself
      const noteRef = doc(this.firestore, 'notes', noteId);
      await deleteDoc(noteRef);
      
      console.log(`Note ${noteId} and all its attachments deleted successfully`);
    } catch (error) {
      console.error('Error deleting note and attachments:', error);
      throw error;
    }
  }

  /**
   * Get notes for a specific user with real-time updates
   * This implementation has two approaches:
   * 1. Try using the optimized query with index first (if index is ready)
   * 2. Fall back to a simpler query without sorting if the index is still building
   * @param userId The ID of the user (client or trainer)
   * @param userType The type of the user ('trainer' or 'client')
   */
  getNotesByUserId(userId: string, userType: string = 'client'): Observable<Note[]> {
    const notesCollection = collection(this.firestore, 'notes');
    const isClient = userType === 'client';
    
    // For clients, we need to query notes where they are the client
    // and the trainer is specified by the userId (which is actually the trainerId)
    if (isClient) {
      // Get the client's own ID
      const uid = this.accountService.getCredentials()()?.uid;
      
      if (!uid) {
        throw new Error('User not authenticated');
      }
      
      console.log('Getting notes for client with ID:', uid, 'from trainer with ID:', userId);
      return new Observable<Note[]>(observer => {
        try {
          // When a client is viewing notes, userId is actually the trainer's ID
          // We need to query for notes where:
          // 1. The client is the current user (uid)
          // 2. The trainer is the specified userId
          const clientQuery = query(
            notesCollection,
            where('clientId', '==', uid),
            where('trainerId', '==', userId)
          );
          
          const unsubscribe = onSnapshot(
            clientQuery,
            (snapshot) => {
              console.log('Got notes for client, processing snapshot with', snapshot.size, 'documents');
              
              try {
                const notes: Note[] = [];
                let visibleCount = 0;
                let hiddenCount = 0;
                
                // Process each document in the snapshot
                snapshot.forEach((doc) => {
                  try {
                    const data = doc.data() as Note;
                    const noteWithId = { ...data, id: doc.id } as Note;
                    
                    // Only include notes that are visible to the client
                    if (data.showToClient === true) {
                      notes.push(noteWithId);
                      visibleCount++;
                    } else {
                      hiddenCount++;
                    }
                  } catch (docError) {
                    console.error('Error processing note document:', docError);
                  }
                });
                
                console.log(`Processed ${visibleCount} visible notes and filtered out ${hiddenCount} hidden notes`);
                
                // Sort by update date
                notes.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
                observer.next(notes);
              } catch (processingError) {
                console.error('Error processing notes snapshot:', processingError);
                observer.next([]);
              }
            },
            (error) => {
              console.error('Error fetching notes for client:', error);
              observer.next([]);  // Return empty array on error for clients
            }
          );
          return unsubscribe;
        } catch (error) {
          console.error('Error setting up notes listener for client:', error);
          observer.next([]);  // Return empty array on error
          return () => {};
        }
      });
    }
    
    // For trainers, we need to query for notes where the trainer is the creator
    // or where the trainer is viewing notes for a specific client
    try {
      // If we're a trainer viewing a client's notes, userId is the clientId
      // We need to get notes where the trainer is the current user
      const uid = this.accountService.getCredentials()()?.uid;
      
      if (!uid) {
        throw new Error('User not authenticated');
      }
      
      // Query for notes where this trainer is the creator and the client is the specified user
      const optimizedQuery = query(
        notesCollection, 
        where('trainerId', '==', uid),
        where('clientId', '==', userId),
        orderBy('updatedAt', 'desc')
      );

      // Use onSnapshot for real-time updates instead of getDocs for one-time fetch
      return new Observable<Note[]>(observer => {
        try {
          const unsubscribe = onSnapshot(optimizedQuery, (snapshot: QuerySnapshot<DocumentData>) => {
            const notes: Note[] = [];
            snapshot.forEach((doc: QueryDocumentSnapshot<DocumentData>) => {
              // Make sure to include the document ID in the data
              const data = doc.data() as Note;
              notes.push({ ...data, id: doc.id });
            });
            observer.next(notes);
          }, (error: Error) => {
            console.log('Error in optimized query snapshot, using fallback', error);
            // Unsubscribe from the current listener
            unsubscribe();
            
            // Handle permission errors based on user type
            const isClientUser = userType === 'client';
            if (isClientUser && error.toString().includes('Missing or insufficient permissions')) {
              console.log('Client has no permissions for these notes, returning empty array');
              observer.next([]);
            } else {
              // For trainers or other errors, try the fallback
              this.getNotesByUserIdFallback(userId, userType).subscribe(
                fallbackNotes => observer.next(fallbackNotes),
                fallbackError => {
                  // If fallback also fails for clients, just return empty array
                  const isClientUser = userType =='client';
                  if (isClientUser) {
                    observer.next([]);
                  } else {
                    observer.error(fallbackError);
                  }
                },
                () => {} // Do nothing on complete
              );
            }
          });
          
          // Return the unsubscribe function for when the Observable is unsubscribed
          return unsubscribe;
        } catch (error) {
          console.log('Error setting up optimized query listener, using fallback', error);
          // If setting up the listener fails, use the fallback
          const fallbackSubscription = this.getNotesByUserIdFallback(userId, userType).subscribe(
            fallbackNotes => observer.next(fallbackNotes),
            fallbackError => {
              // If fallback also fails for clients, just return empty array
              const isClientUser = userType === 'client';
              if (isClientUser) {
                console.log('Fallback failed for client, returning empty array');
                observer.next([]);
              } else {
                observer.error(fallbackError);
              }
            },
            () => {} // Do nothing on complete
          );
          
          // Return a function to unsubscribe from the fallback subscription
          return () => fallbackSubscription.unsubscribe();
        }
      });
    } catch (error: unknown) {
      console.log('Error in optimized query setup, using fallback', error);
      return this.getNotesByUserIdFallback(userId, userType);
    }
  }

  /**
   * Fallback method to get notes with real-time updates without requiring an index
   * This will be used while the index is building
   * @param userId The ID of the user (client or trainer)
   * @param userType The type of the user ('trainer' or 'client')
   */
  private getNotesByUserIdFallback(userId: string, userType: string = 'trainer'): Observable<Note[]> {
    const notesCollection = collection(this.firestore, 'notes');
    const isClient = userType === 'client';
    
    // For all users, query by the appropriate field and filter client visibility in memory
    // This is simpler and works with our permissive security rules
    console.log('Using fallback query for', isClient ? 'client' : 'trainer');
    
    let simpleQuery;
    
    if (isClient) {
      // For clients, we need to get the client's own ID
      const uid = this.accountService.getCredentials()()?.uid;
      
      if (!uid) {
        throw new Error('User not authenticated');
      }
      
      // When a client is viewing notes, userId is actually the trainer's ID
      // We need to query for notes where:
      // 1. The client is the current user (uid)
      // 2. The trainer is the specified userId
      simpleQuery = query(
        notesCollection, 
        where('clientId', '==', uid),
        where('trainerId', '==', userId)
        // No orderBy here, so no index required
      );
    } else {
      // For trainers, we need to get notes where the trainer is the creator and the client is the specified user
      const uid = this.accountService.getCredentials()()?.uid;
      
      if (!uid) {
        throw new Error('User not authenticated');
      }
      
      simpleQuery = query(
        notesCollection, 
        where('trainerId', '==', uid),
        where('clientId', '==', userId)
        // No orderBy here, so no index required
      );
    }

    // Use onSnapshot for real-time updates
    return new Observable<Note[]>(observer => {
      const unsubscribe = onSnapshot(simpleQuery, (snapshot: QuerySnapshot<DocumentData>) => {
        console.log('Fallback method: processing snapshot with', snapshot.size, 'documents');
        
        try {
          const notes: Note[] = [];
          let visibleCount = 0;
          let hiddenCount = 0;
          
          snapshot.forEach((doc: QueryDocumentSnapshot<DocumentData>) => {
            try {
              // Make sure to include the document ID in the data
              const data = doc.data() as Note;
              const noteWithId = { ...data, id: doc.id } as Note;
              
              // For clients, only include notes that are visible to them
              if (!isClient || (isClient && data.showToClient === true)) {
                notes.push(noteWithId);
                visibleCount++;
              } else if (isClient) {
                hiddenCount++;
              }
            } catch (docError) {
              console.error('Error processing note document in fallback:', docError);
            }
          });
          
          console.log(`Fallback: Processed ${visibleCount} visible notes and filtered out ${hiddenCount} hidden notes`);
          
          // Sort the notes in memory instead of in the query
          const sortedNotes = notes.sort((a, b) => {
            return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
          });
          observer.next(sortedNotes);
        } catch (processingError) {
          console.error('Error processing notes snapshot in fallback:', processingError);
          observer.next([]);
        }
      }, (error: Error) => {
        console.error('Error in fallback query snapshot:', error);
        
        // If this is a client, just return an empty array instead of propagating the error
        // This is expected behavior since clients can only see notes marked as showToClient=true
        if (userType === 'client') {
          observer.next([]);
        } else {
          observer.error(error);
        }
      });
      
      // Return the unsubscribe function
      return unsubscribe;
    });
  }

  /**
   * Get a specific note by ID
   */
  getNoteById(noteId: string): Observable<Note | null> {
    const noteRef = doc(this.firestore, 'notes', noteId);
    
    return from(getDoc(noteRef)).pipe(
      map(docSnap => {
        if (docSnap.exists()) {
          return docSnap.data() as Note;
        }
        return null;
      })
    );
  }

  /**
   * Upload a file for a note
   */
  async uploadNoteFile(noteId: string, file: File): Promise<NoteFile> {
    const uid = this.accountService.getCredentials()()?.uid;
    
    if (!uid) {
      throw new Error('User not authenticated');
    }

    // Security checks
    await this.validateFile(file);

    // Create a unique file path
    const fileId = doc(collection(this.firestore, 'noteFiles')).id;
    const filePath = `notes/${noteId}/${fileId}_${file.name}`;
    
    // Use FileUploadService instead of direct upload (iOS-compliant)
    const downloadUrl = await this.fileUploadService.uploadFile(filePath, file);
    
    // Create file metadata
    const fileData: NoteFile = {
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
    await setDoc(doc(this.firestore, 'noteFiles', fileId), fileData);
    
    return fileData;
  }
  
  /**
   * Delete a file from a note
   */
  async deleteNoteFile(fileId: string, filePath?: string): Promise<void> {
    const uid = this.accountService.getCredentials()()?.uid;
    
    if (!uid) {
      throw new Error('User not authenticated');
    }
    
    try {
      if (filePath) {
        // If filePath is provided, delete directly from storage
        const storageRef = ref(this.storage, filePath);
        await deleteObject(storageRef).catch(err => {
          console.warn('File may not exist in storage:', err);
          // Continue with deletion even if storage deletion fails
        });
      } else {
        // If no filePath, try to get file data first to find the storage path
        const fileRef = doc(this.firestore, 'noteFiles', fileId);
        const fileSnap = await getDoc(fileRef);
        
        if (fileSnap.exists()) {
          const fileData = fileSnap.data() as NoteFile;
          if (fileData.filePath) {
            const storageRef = ref(this.storage, fileData.filePath);
            await deleteObject(storageRef).catch(err => {
              console.warn('File may not exist in storage:', err);
              // Continue with deletion even if storage deletion fails
            });
          }
        }
      }
      
      // Delete the file metadata from Firestore
      await deleteDoc(doc(this.firestore, 'noteFiles', fileId));
    } catch (error) {
      console.error('Error deleting file:', error);
      throw error;
    }
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
    
    // Additional security checks could be added here
    // For example, scanning file content, checking for malicious data, etc.
  }

  /**
   * Get files for a specific note
   */
  getNoteFiles(noteId: string): Observable<NoteFile[]> {
    const filesCollection = collection(this.firestore, 'noteFiles');
    const filesQuery = query(
      filesCollection,
      where('noteId', '==', noteId),
      orderBy('uploadedAt', 'desc')
    );

    return from(getDocs(filesQuery)).pipe(
      map(snapshot => {
        const files: NoteFile[] = [];
        snapshot.forEach(doc => {
          files.push(doc.data() as NoteFile);
        });
        return files;
      }),
      catchError(error => {
        // If we get an index error, fall back to a simpler query without ordering
        if (error.code === 'failed-precondition' || error.message?.includes('requires an index')) {
          console.warn('Index missing for noteFiles query. Using fallback query without sorting.');
          console.info('Create the required index at: https://console.firebase.google.com/project/_/firestore/indexes');
          
          // Fallback query without ordering
          const fallbackQuery = query(
            filesCollection,
            where('noteId', '==', noteId)
          );
          
          return from(getDocs(fallbackQuery)).pipe(
            map(snapshot => {
              const files: NoteFile[] = [];
              snapshot.forEach(doc => {
                files.push(doc.data() as NoteFile);
              });
              // Sort manually in memory
              return files.sort((a, b) => {
                const dateA = new Date(a.uploadedAt).getTime();
                const dateB = new Date(b.uploadedAt).getTime();
                return dateB - dateA; // descending order
              });
            })
          );
        }
        // If it's another type of error, propagate it
        return throwError(() => error);
      })
    );
  }


}
