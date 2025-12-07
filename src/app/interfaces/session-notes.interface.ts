/**
 * Interface for session notes
 */
export interface SessionNote {
  id: string;
  datetime: string;      // ISO string format
  clientId: string;      // Client the session note is for
  trainerId: string;     // Trainer who created the note
  name: string;          // Name/title of the session note
  text: string;          // Content of the session note
  attachmentIds: string[]; // IDs of attachments linked to this note
  createdAt: string;     // ISO string format
  updatedAt: string;     // ISO string format
}

/**
 * Interface for session note attachments
 */
export interface SessionNoteAttachment {
  id: string;
  noteId: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  filePath?: string;     // Path in storage for deletion
  uploadedAt: string;    // ISO string format
  uploadedBy: string;    // User ID who uploaded the attachment
}
