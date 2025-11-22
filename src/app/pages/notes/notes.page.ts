import { Component, OnInit, OnDestroy, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ActionSheetController, AlertController, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonContent, IonFab, IonFabButton, IonFabList, IonGrid, IonHeader, IonIcon, IonInput, IonItem, IonLabel, IonList, IonRow, IonCol, IonSpinner, IonTextarea, IonTitle, IonToolbar, ModalController, Platform, ToastController } from '@ionic/angular/standalone';
import { HeaderComponent } from 'src/app/components/header/header.component';
import { FilePreviewComponent } from 'src/app/components/file-preview/file-preview.component';
import { Note, NoteFile, NotesService } from 'src/app/services/notes.service';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { addIcons } from 'ionicons';
import { 
  add, addOutline, addCircle, 
  camera, cameraOutline, 
  checkmarkOutline, closeOutline, 
  create, createOutline, 
  document, documentAttachOutline, documentOutline, 
  documentText, documentTextOutline, 
  ellipsisVertical, ellipsisVerticalOutline, 
  eye, eyeOutline, eyeOff, eyeOffOutline, 
  pencil, pencilOutline, 
  radioButtonOn,
  trash, trashOutline, 
  ellipse,
  downloadOutline
} from 'ionicons/icons';
import { UserService } from 'src/app/services/account/user.service';
import { AccountService } from 'src/app/services/account/account.service';
import { Subscription } from 'rxjs';
import { AutocorrectDirective } from 'src/app/directives/autocorrect.directive';
import { SessionNotesComponent } from 'src/app/components/sessions/session-notes/session-notes.component';

@Component({
  selector: 'app-notes',
  templateUrl: './notes.page.html',
  styleUrls: ['./notes.page.scss'],
  standalone: true,
  imports: [
    IonContent, 
    CommonModule, 
    FormsModule, 
    HeaderComponent,
    IonButton,
    IonFab,
    IonFabButton,
    IonFabList,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonList,
    IonItem,
    IonTextarea,
    IonIcon,
    IonInput,
    IonLabel,
    IonSpinner,
    FilePreviewComponent,
    AutocorrectDirective,
    SessionNotesComponent
  ]
})
export class NotesPage implements OnInit, OnDestroy {
  receiverId: string | null = null;
  notes: Note[] = [];
  generalNotes: Note[] = [];
  workoutNotes: Note[] = [];
  isLoading = true;
  isTrainer = false;
  accountType: 'trainer' | 'client' = 'client';
  uid: string | null = null;
  dateFromQueryParams: Date = new Date();
  private notesSubscription: Subscription | null = null;
  
  // Map to store files for each note
  noteFiles: Map<string, NoteFile[]> = new Map<string, NoteFile[]>();
  loadingFiles: Map<string, boolean> = new Map<string, boolean>();
  
  // Properties for inline editing
  isEditingTitle: string | null = null; // Stores the ID of the note being edited
  isEditingContent: string | null = null; // Stores the ID of the note whose content is being edited
  editableContent: string = ''; // Temporary storage for content being edited
  editableTitle: string = ''; // Temporary storage for title being edited

  private route = inject(ActivatedRoute);
  private notesService = inject(NotesService);
  private actionSheetCtrl = inject(ActionSheetController);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);
  private modalCtrl = inject(ModalController);
  private accountService = inject(AccountService);
  private userService = inject(UserService);
  private platform = inject(Platform);

  constructor() {
    addIcons({
      add,
      addOutline,
      addCircle,
      camera,
      cameraOutline,
      checkmarkOutline,
      closeOutline,
      create,
      createOutline,
      downloadOutline,
      document,
      documentAttachOutline,
      documentOutline,
      documentText,
      documentTextOutline,
      ellipse,
      ellipsisVertical,
      ellipsisVerticalOutline,
      eye,
      eyeOutline,
      eyeOff,
      eyeOffOutline,
      pencil,
      pencilOutline,
      radioButtonOn,
      trash,
      trashOutline
    });
  }

  ngOnInit() {
    // Get current user info
    const credentials = this.accountService.getCredentials()();
    if (credentials?.uid) {
      this.uid = credentials.uid;
      
      // Get account type from user service
      const userInfo = this.userService.getUserInfo()();
      if (userInfo) {
        this.accountType = userInfo.accountType;
        this.isTrainer = this.accountType === 'trainer';
      }
      
      // Get the receiverId from the route params
      this.receiverId = this.route.snapshot.paramMap.get('receiverId');
      
      // Check for date in query parameters
      const dateParam = this.route.snapshot.queryParamMap.get('date');
      if (dateParam) {
        try {
          // Parse the date from the query parameter (YYYY-MM-DD format)
          // Create a date at noon to avoid timezone issues
          // The format is YYYY-MM-DD
          const [year, month, day] = dateParam.split('-').map(Number);
          // Set time to noon to avoid timezone issues
          this.dateFromQueryParams = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
          console.log('Date from query params:', this.dateFromQueryParams);
        } catch (error) {
          console.error('Error parsing date from query params:', error);
        }
      }
      
      // Debug user information
      console.log('User info:', {
        uid: this.uid,
        accountType: this.accountType,
        receiverIdFromRoute: this.receiverId
      });
      
      // For clients viewing notes, receiverId should be the trainer's ID
      // If no receiverId is specified in the route, we need to handle this differently
      // For now, we'll keep the existing logic but add a comment about the correct interpretation
      if (!this.receiverId && this.accountType === 'client') {
        // Note: For clients, receiverId should be the trainer's ID, not their own ID
        // This will be handled correctly in the NotesService now
        console.log('Setting receiverId to client\'s own ID for default view:', this.uid);
        this.receiverId = this.uid;
      }
      
      // Log the final receiverId that will be used for queries
      console.log('Final receiverId for queries:', this.receiverId);
      
      if (this.receiverId) {
        this.loadNotes();
      }
    }
  }

  async loadNotes() {
    this.isLoading = true;
    
    if (!this.receiverId) {
      this.isLoading = false;
      return;
    }

    // Clean up any existing subscription first
    if (this.notesSubscription) {
      this.notesSubscription.unsubscribe();
      this.notesSubscription = null;
    }

    // Create a new subscription with real-time updates
    // Pass the user's account type to ensure proper filtering based on permissions
    this.notesSubscription = this.notesService.getNotesByUserId(this.receiverId, this.accountType).subscribe(
      // Success handler
      notes => {
        this.notes = notes;
        this.generalNotes = notes; // No need to filter by type anymore
        this.isLoading = false;
        
        // Load files for each note
        notes.forEach(note => {
          this.loadFilesForNote(note.id);
        });
      },
      // Error handler
      error => {
        console.error('Error loading notes:', error);
        this.isLoading = false;
        
        // If this is a client and there's a permission error, just show empty notes
        // This is expected behavior since clients can only see notes marked as showToClient=true
        if (this.accountType === 'client') {
          this.notes = [];
          this.generalNotes = [];
        }
      }
    );
  }

  async addNewNote() {
    if (!this.receiverId || !this.uid) return;

    try {
      // Create a new note with default title and empty content
      const defaultTitle = 'New Note';
      const emptyContent = ['Click to edit content'];
      
      // Determine the correct clientId and trainerId based on account type
      let clientId: string;
      let trainerId: string;
      
      if (this.accountType === 'trainer') {
        // If user is a trainer, they are creating a note for a client
        // trainerId = current user's ID, clientId = receiverId
        trainerId = this.uid!;
        clientId = this.receiverId!;
      } else {
        // If user is a client, they shouldn't be creating notes
        // But if they do, set clientId to their own ID and trainerId to receiverId
        clientId = this.uid!;
        trainerId = this.receiverId!;
      }
      
      console.log('Creating note with:', { clientId, trainerId });
      
      const newNote = await this.notesService.createNote({
        title: defaultTitle,
        content: emptyContent,
        clientId: clientId,
        trainerId: trainerId,
        showToClient: false,
        type: 'general' // Always use 'general' type
      });
      
      // Automatically start editing the new note's title
      setTimeout(() => {
        this.editNoteTitle(newNote);
      }, 300);
      
      // The real-time listener will update the UI
    } catch (error) {
      console.error('Error adding note:', error);
      this.showToast('Failed to add note');
    }
  }

  async editNote(note: Note) {
    const alert = await this.alertCtrl.create({
      header: `Edit ${note.title}`,
      inputs: [
        {
          name: 'title',
          type: 'text',
          placeholder: 'Title',
          value: note.title
        },
        {
          name: 'content',
          type: 'textarea',
          placeholder: 'Content',
          value: note.content.join('\n')
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Save',
          handler: async (data) => {
            if (!data.title || !data.content) {
              this.showToast('Title and content are required');
              return;
            }

            // Convert content to array of bullet points
            const contentLines = data.content.split('\n')
              .map((line: string) => line.trim())
              .filter((line: string) => line.length > 0);

            try {
              await this.notesService.updateNote(note.id, {
                title: data.title,
                content: contentLines
              });

              this.showToast('Note updated successfully');
            } catch (error) {
              console.error('Error updating note:', error);
              this.showToast('Failed to update note');
            }
          }
        }
      ]
    });

    await alert.present();
  }

  async deleteNote(note: Note) {
    const alert = await this.alertCtrl.create({
      header: 'Confirm Delete',
      message: `Are you sure you want to delete "${note.title}"?`,
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
              await this.notesService.deleteNote(note.id);
              this.showToast('Note deleted successfully');
            } catch (error) {
              console.error('Error deleting note:', error);
              this.showToast('Failed to delete note');
            }
          }
        }
      ]
    });

    await alert.present();
  }

  async toggleShowToClient(note: Note) {
    try {
      // Update the note in Firestore
      await this.notesService.updateNote(note.id, {
        showToClient: !note.showToClient
      });
      
      // Update the local note object to reflect the change immediately
      // This provides immediate UI feedback before the real-time listener updates
      const updatedVisibility = !note.showToClient;
      note.showToClient = updatedVisibility;
      
      this.showToast(
        !updatedVisibility ? 
        'Note is now hidden from client' : 
        'Note is now visible to client'
      );
    } catch (error) {
      console.error('Error updating note visibility:', error);
      this.showToast('Failed to update note visibility');
    }
  }

  async showNoteOptions(note: Note) {
    const actionSheet = await this.actionSheetCtrl.create({
      header: 'Note Options',
      buttons: [
        {
          text: 'Edit',
          icon: 'pencil',
          handler: () => {
            this.editNote(note);
          }
        },
        {
          text: 'Delete',
          role: 'destructive',
          icon: 'trash',
          handler: () => {
            this.deleteNote(note);
          }
        },
        {
          text: 'Cancel',
          role: 'cancel'
        }
      ]
    });

    await actionSheet.present();
  }

  async addWorkoutContent(note: Note) {
    const actionSheet = await this.actionSheetCtrl.create({
      header: 'Add Content',
      buttons: [
        {
          text: 'File',
          icon: 'document',
          handler: () => {
            this.addFile(note);
          }
        },
        {
          text: 'Note',
          icon: 'document-text',
          handler: () => {
            this.addTextNote(note);
          }
        },
        {
          text: 'Camera',
          icon: 'camera',
          handler: () => {
            this.takePicture(note);
          }
        },
        {
          text: 'Cancel',
          role: 'cancel'
        }
      ]
    });

    await actionSheet.present();
  }

  async addFile(note: Note | null) {
    if (!this.receiverId || !this.uid) return;
    
    try {
      
      // For iOS/mobile devices, use a different approach
      if (this.platform.is('capacitor')) {
        // Present action sheet for file source selection
        const actionSheet = await this.actionSheetCtrl.create({
          header: 'Select File Source',
          buttons: [
            {
              text: 'Document',
              icon: 'document',
              handler: async () => {
                await this.selectDocumentFile(note);
              }
            },
            {
              text: 'Cancel',
              role: 'cancel'
            }
          ]
        });
        
        await actionSheet.present();
        return;
      }
      
      // Web approach - create a file input element
      // Using window.document to ensure TypeScript recognizes it correctly
      const fileInput = window.document.createElement('input') as HTMLInputElement;
      fileInput.type = 'file';
      fileInput.accept = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.jpg,.jpeg,.png,.gif';
      fileInput.style.display = 'none';
      window.document.body.appendChild(fileInput);
      
      // Handle file selection
      fileInput.onchange = async (e: Event) => {
        const target = e.target as HTMLInputElement;
        const files = target.files;
        
        if (files && files.length > 0) {
          const file = files[0];
          
          try {
            this.showToast('Uploading file...');
            // Store the uploaded file data and update the UI
            const fileData = await this.notesService.uploadNoteFile(note!.id, file);
            
            // Add the file to the noteFiles map if it exists, or create a new entry
            const currentFiles = this.noteFiles.get(note!.id) || [];
            this.noteFiles.set(note!.id, [...currentFiles, fileData]);
            
            this.showToast('File uploaded successfully');
          } catch (error: any) {
            console.error('Error uploading file:', error);
            this.showToast(error.message || 'Failed to upload file');
          }
        }
        
        // Clean up
        window.document.body.removeChild(fileInput);
      };
      
      // Trigger file selection dialog
      fileInput.click();
    } catch (error: any) {
      console.error('Error in file upload process:', error);
      this.showToast(error.message || 'An error occurred');
    }
  }

  async addTextNote(note: Note) {
    const alert = await this.alertCtrl.create({
      header: 'Add Note',
      inputs: [
        {
          name: 'content',
          type: 'textarea',
          placeholder: 'Enter note content'
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Add',
          handler: async (data) => {
            if (!data.content) {
              this.showToast('Content is required');
              return;
            }

            // Add the new content to the existing content
            const updatedContent = [...note.content, data.content];

            try {
              await this.notesService.updateNote(note.id, {
                content: updatedContent
              });

              this.showToast('Note added successfully');
            } catch (error) {
              console.error('Error adding note content:', error);
              this.showToast('Failed to add note content');
            }
          }
        }
      ]
    });

    await alert.present();
  }

  // Helper method to create a new note if needed
  private async ensureNoteExists(note: Note | null, title: string): Promise<Note> {
    if (!this.receiverId || !this.uid) throw new Error('Missing user information');
    
    if (note) return note;
    
    // Determine the correct clientId and trainerId based on account type
    let clientId: string;
    let trainerId: string;
    
    if (this.accountType === 'trainer') {
      // If user is a trainer, they are creating a note for a client
      trainerId = this.uid!;
      clientId = this.receiverId!;
    } else {
      // If user is a client, they shouldn't be creating notes
      // But if they do, set clientId to their own ID and trainerId to receiverId
      clientId = this.uid!;
      trainerId = this.receiverId!;
    }
    
    console.log(`Creating note with ${title}:`, { clientId, trainerId });
    
    // Create a new note
    return await this.notesService.createNote({
      title: title,
      content: [`${title} attachment`],
      clientId: clientId,
      trainerId: trainerId,
      showToClient: false,
      type: 'general'
    });
  }

  async selectFromPhotoLibrary(note: Note | null) {
    try {
      // Show loading toast
      this.showToast('Opening photo library...');
      
      // Use Capacitor Camera API with Photo Library source
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: true,
        resultType: CameraResultType.Base64,
        source: CameraSource.Photos,
        correctOrientation: true
      });
      
      if (!image.base64String) {
        throw new Error('No image data received');
      }
      
      // Now that we have a photo, create a note if one doesn't exist
      note = await this.ensureNoteExists(note, 'Photo');
      
      // Convert base64 to blob
      const blob = this.b64toBlob(
        image.base64String,
        `image/${image.format || 'jpeg'}`
      );
      
      // Create a file from the blob
      const fileName = `photo_${Date.now()}.${image.format || 'jpeg'}`;
      const file = new File([blob], fileName, { type: `image/${image.format || 'jpeg'}` });
      
      // Upload the file
      this.showToast('Uploading photo...');
      const fileData = await this.notesService.uploadNoteFile(note.id, file);
      
      // Add the file to the noteFiles map
      const currentFiles = this.noteFiles.get(note.id) || [];
      this.noteFiles.set(note.id, [...currentFiles, fileData]);
      
      this.showToast('Photo uploaded successfully');
    } catch (error: any) {
      console.error('Error selecting from photo library:', error);
      this.showToast(error.message || 'Failed to select photo');
    }
  }

  /**
   * Legacy method kept for web platform - on iOS this is replaced by selectDocumentFile
   */
  async selectFromFiles(note: Note | null) {
    try {
      // Show loading toast
      this.showToast('Opening file picker...');
      
      // Web approach - create a file input element
      const fileInput = window.document.createElement('input') as HTMLInputElement;
      fileInput.type = 'file';
      fileInput.accept = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.jpg,.jpeg,.png,.gif';
      fileInput.style.display = 'none';
      window.document.body.appendChild(fileInput);
      
      // Create a promise that resolves when a file is selected
      const fileSelected = new Promise<void>((resolve, reject) => {
        fileInput.onchange = async (e: Event) => {
          const target = e.target as HTMLInputElement;
          const files = target.files;
          
          if (files && files.length > 0) {
            const file = files[0];
            
            try {
              // Now that we have a file, create a note if one doesn't exist
              note = await this.ensureNoteExists(note, 'File');
              
              this.showToast('Uploading file...');
              // Store the uploaded file data and update the UI
              const fileData = await this.notesService.uploadNoteFile(note.id, file);
              
              // Add the file to the noteFiles map if it exists, or create a new entry
              const currentFiles = this.noteFiles.get(note.id) || [];
              this.noteFiles.set(note.id, [...currentFiles, fileData]);
              
              this.showToast('File uploaded successfully');
              resolve();
            } catch (error: any) {
              console.error('Error uploading file:', error);
              this.showToast(error.message || 'Failed to upload file');
              reject(error);
            }
          } else {
            resolve(); // User canceled selection
          }
          
          // Clean up
          window.document.body.removeChild(fileInput);
        };
      });
      
      // Trigger file selection dialog
      fileInput.click();
      
      // Wait for file selection
      await fileSelected;
    } catch (error: any) {
      console.error('Error selecting file:', error);
      this.showToast(error.message || 'Failed to select file');
    }
  }
  
  /**
   * Select document files specifically on iOS devices using the FilePicker plugin
   */
  async selectDocumentFile(note: Note | null) {
    try {
      // Show loading toast
      this.showToast('Opening document picker...');
      
      if (this.platform.is('capacitor')) {
        try {
          // Use the dedicated FilePicker plugin for proper document selection
          const result = await FilePicker.pickFiles({
            // Specify document types for iOS
            types: [
              'application/pdf', 
              'text/plain',
              'application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.ms-excel',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.ms-powerpoint',
              'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              'text/csv'
            ],
            // Note: 'limit' controls how many files can be selected (default is 1)
            readData: true // Important: Read the file data directly
          });
          
          if (result && result.files && result.files.length > 0) {
            const fileData = result.files[0];
            console.log('Document selected:', fileData);
            
            // Check if we have the file data
            if (!fileData.data) {
              console.error('No file data received');
              this.showToast('Could not read the selected document');
              return;
            }
            
            // Now that we have a document, create a note if one doesn't exist
            note = await this.ensureNoteExists(note, 'Document');
            
            // Get the file name
            const fileName = fileData.name || 'document.pdf';
            
            // Create a blob from the base64 data
            const blob = this.b64toBlob(
              fileData.data,
              fileData.mimeType || 'application/pdf'
            );
            
            // Create a File object
            const file = new File([blob], fileName, { 
              type: fileData.mimeType || 'application/pdf' 
            });
            
            // Upload the file
            this.showToast('Uploading document...');
            const uploadedFile = await this.notesService.uploadNoteFile(note.id, file);
            
            // Add the file to the noteFiles map
            const currentFiles = this.noteFiles.get(note.id) || [];
            this.noteFiles.set(note.id, [...currentFiles, uploadedFile]);
            
            this.showToast('Document uploaded successfully');
          } else {
            // User canceled or no file was selected
            console.log('No document selected or selection canceled');
          }
        } catch (error: any) {
          console.error('Error with document picker:', error);
          
          // Handle permission errors specifically
          if (error.message && (
              error.message.includes('permission') || 
              error.message.includes('Permission') ||
              error.message.includes('denied') ||
              error.message.includes('Denied')
            )) {
            this.showToast('File access permission denied. Please enable access in your device settings.');
          } else {
            this.showToast(error.message || 'Failed to select document');
          }
        }
      } else {
        // For web, use the regular file picker with document-specific MIME types
        const fileInput = window.document.createElement('input') as HTMLInputElement;
        fileInput.type = 'file';
        fileInput.accept = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv';
        fileInput.style.display = 'none';
        window.document.body.appendChild(fileInput);
        
        // Create a promise that resolves when a file is selected
        const fileSelected = new Promise<void>((resolve, reject) => {
          fileInput.onchange = async (e: Event) => {
            const target = e.target as HTMLInputElement;
            const files = target.files;
            
            if (files && files.length > 0) {
              const file = files[0];
              
              try {
                this.showToast('Uploading document...');
                // Store the uploaded file data and update the UI
                const fileData = await this.notesService.uploadNoteFile(note!.id, file);
                
                // Add the file to the noteFiles map if it exists, or create a new entry
                const currentFiles = this.noteFiles.get(note!.id) || [];
                this.noteFiles.set(note!.id, [...currentFiles, fileData]);
                
                this.showToast('Document uploaded successfully');
                resolve();
              } catch (error: any) {
                console.error('Error uploading document:', error);
                this.showToast(error.message || 'Failed to upload document');
                reject(error);
              }
            } else {
              resolve(); // User canceled selection
            }
            
            // Clean up
            window.document.body.removeChild(fileInput);
          };
        });
        
        // Trigger file selection dialog
        fileInput.click();
        
        // Wait for file selection
        await fileSelected;
      }
    } catch (error: any) {
      console.error('Error selecting document:', error);
      this.showToast(error.message || 'Failed to select document');
    }
  }

  async takePicture(note: Note | null) {
    try {
      // For iOS/mobile devices, present options for camera or photo library
      if (this.platform.is('capacitor')) {
        // Present action sheet for photo source selection
        const actionSheet = await this.actionSheetCtrl.create({
          header: 'Select Photo Source',
          buttons: [
            {
              text: 'Take Photo',
              icon: 'camera',
              handler: () => {
                this.capturePhoto(note);
              }
            },
            {
              text: 'Photo Library',
              icon: 'image',
              handler: () => {
                this.selectFromPhotoLibrary(note);
              }
            },
            {
              text: 'Cancel',
              role: 'cancel'
            }
          ]
        });
        
        await actionSheet.present();
      } else {
        // On web, just use the camera directly
        await this.capturePhoto(note);
      }
    } catch (error: any) {
      console.error('Error in photo handling:', error);
      this.showToast(error.message || 'Failed to process photo');
    }
  }
  
  /**
   * Capture a photo using the device camera
   */
  private async capturePhoto(note: Note | null) {
    try {
      // Show loading toast
      this.showToast('Opening camera...');
      
      // Use Capacitor Camera API (works on iOS and Android)
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: true,
        resultType: CameraResultType.Base64,
        source: CameraSource.Camera,
        correctOrientation: true,
        saveToGallery: true // Save to device gallery for iOS
      });

      if (!image.base64String) {
        throw new Error('No image data received');
      }
      
      // Now that we have a photo, create a note if one doesn't exist
      note = await this.ensureNoteExists(note, 'Photo');

      this.showToast('Processing image...');

      // Convert base64 to blob
      const blob = this.b64toBlob(
        image.base64String, 
        `image/${image.format || 'jpeg'}`
      );

      // Create a file from the blob with a secure name
      const timestamp = new Date().getTime();
      const randomString = Math.random().toString(36).substring(2, 8);
      const secureFilename = `photo_${timestamp}_${randomString}.${image.format || 'jpeg'}`;
      
      const file = new File(
        [blob], 
        secureFilename,
        { type: `image/${image.format || 'jpeg'}` }
      );

      // Upload the file
      this.showToast('Uploading photo...');
      const fileData = await this.notesService.uploadNoteFile(note.id, file);
      
      // Add the file to the noteFiles map
      const currentFiles = this.noteFiles.get(note.id) || [];
      this.noteFiles.set(note.id, [...currentFiles, fileData]);
      
      this.showToast('Photo uploaded successfully');
    } catch (error: any) {
      console.error('Error in photo capture process:', error);
      
      // Handle permission errors specifically
      if (error.message && (
          error.message.includes('permission') || 
          error.message.includes('Permission') ||
          error.message.includes('denied') ||
          error.message.includes('Denied')
        )) {
        this.showToast('Camera permission denied. Please enable camera access in your device settings.');
      } else {
        this.showToast(error.message || 'Failed to upload photo');
      }
    }
  }

  // Helper to convert base64 to Blob
  private b64toBlob(b64Data: string, contentType: string): Blob {
    const byteCharacters = atob(b64Data);
    const byteArrays = [];

    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
      const slice = byteCharacters.slice(offset, offset + 512);

      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }

      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }

    return new Blob(byteArrays, { type: contentType });
  }

  ngOnDestroy() {
    // Clean up subscriptions when component is destroyed
    if (this.notesSubscription) {
      this.notesSubscription.unsubscribe();
      this.notesSubscription = null;
    }
  }
  
  /**
   * Load files for a specific note
   */
  loadFilesForNote(noteId: string) {
    // Mark as loading
    this.loadingFiles.set(noteId, true);
    
    // Get files for this note
    this.notesService.getNoteFiles(noteId).subscribe({
      next: (files) => {
        // Store files in the map
        this.noteFiles.set(noteId, files);
        this.loadingFiles.set(noteId, false);
      },
      error: (error) => {
        console.error(`Error loading files for note ${noteId}:`, error);
        this.loadingFiles.set(noteId, false);
      }
    });
  }
  
  /**
   * Delete a file from a note
   */
  async deleteNoteFile(fileData: {id: string, path: string}, noteId: string) {
    try {
      await this.notesService.deleteNoteFile(fileData.id, fileData.path || '');
      
      // Update the UI by removing the file from the list
      const currentFiles = this.noteFiles.get(noteId) || [];
      const updatedFiles = currentFiles.filter(file => file.id !== fileData.id);
      this.noteFiles.set(noteId, updatedFiles);
      
      this.showToast('File deleted successfully');
    } catch (error: any) {
      console.error('Error deleting file:', error);
      this.showToast(error.message || 'Failed to delete file');
    }
  }
  
  /**
   * Methods for inline editing
   */
  editNoteTitle(note: Note) {
    if (!this.isTrainer) return;
    this.isEditingTitle = note.id;
    this.editableTitle = note.title;
  }

  saveNoteTitle(note: Note) {
    if (!this.isEditingTitle) return;
    
    const newTitle = this.editableTitle.trim();
    if (newTitle && newTitle !== note.title) {
      this.notesService.updateNote(note.id, { title: newTitle });
      // Update local note for immediate UI feedback
      note.title = newTitle;
    }
    
    this.isEditingTitle = null;
  }

  editNoteContent(note: Note) {
    if (!this.isTrainer) return;
    this.isEditingContent = note.id;
    this.editableContent = note.content.join('\n');
  }

  saveNoteContent(note: Note) {
    if (!this.isEditingContent) return;
    
    const contentLines = this.editableContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    if (contentLines.length > 0) {
      this.notesService.updateNote(note.id, { content: contentLines });
      // Update local note for immediate UI feedback
      note.content = contentLines;
    }
    
    this.isEditingContent = null;
    this.editableContent = '';
  }

  cancelContentEdit() {
    this.isEditingContent = null;
    this.editableContent = '';
  }

  private async showToast(message: string) {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      position: 'bottom'
    });

    await toast.present();
  }
}
