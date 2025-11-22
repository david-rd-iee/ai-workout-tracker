import { Component, Input, OnInit, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController } from '@ionic/angular';
import { DomSanitizer, SafeResourceUrl, SafeUrl } from '@angular/platform-browser';
import { addIcons } from 'ionicons';
import { downloadOutline } from 'ionicons/icons';

@Component({
  selector: 'app-file-preview',
  templateUrl: './file-preview.component.html',
  styleUrls: ['./file-preview.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class FilePreviewComponent implements OnInit {
  @Input() fileUrl: string = '';
  @Input() fileName: string = '';
  @Input() fileType: string = '';
  @Input() fileId: string = '';
  @Input() filePath: string = '';
  @Input() canDelete: boolean = true;
  
  @Output() deleteFile = new EventEmitter<{id: string, path: string}>();
  
  safeUrl: SafeUrl | null = null;
  safeResourceUrl: SafeResourceUrl | null = null;
  previewType: 'image' | 'pdf' | 'video' | 'audio' | 'other' = 'other';
  isLoading: boolean = true;
  error: string | null = null;
  
  constructor(private sanitizer: DomSanitizer, private alertController: AlertController) {
    addIcons({
      downloadOutline
    });
  }
  
  ngOnInit() {
    this.determineFileType();
    this.preparePreview();
  }
  
  private determineFileType() {
    if (!this.fileType) {
      // Try to determine file type from extension if not provided
      const extension = this.fileName.split('.').pop()?.toLowerCase();
      if (extension) {
        switch (extension) {
          case 'jpg':
          case 'jpeg':
          case 'png':
          case 'gif':
          case 'webp':
          case 'heic':
          case 'heif':
            this.fileType = `image/${extension}`;
            break;
          case 'pdf':
            this.fileType = 'application/pdf';
            break;
          case 'mp4':
          case 'webm':
          case 'mov':
            this.fileType = `video/${extension}`;
            break;
          case 'mp3':
          case 'wav':
          case 'ogg':
            this.fileType = `audio/${extension}`;
            break;
        }
      }
    }
    
    // Determine preview type based on file type
    if (this.fileType.startsWith('image/')) {
      this.previewType = 'image';
    } else if (this.fileType === 'application/pdf') {
      this.previewType = 'pdf';
    } else if (this.fileType.startsWith('video/')) {
      this.previewType = 'video';
    } else if (this.fileType.startsWith('audio/')) {
      this.previewType = 'audio';
    } else {
      this.previewType = 'other';
    }
  }
  
  private preparePreview() {
    try {
      this.safeUrl = this.sanitizer.bypassSecurityTrustUrl(this.fileUrl);
      this.safeResourceUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.fileUrl);
      this.isLoading = false;
    } catch (error) {
      console.error('Error preparing file preview:', error);
      this.error = 'Failed to load preview';
      this.isLoading = false;
    }
  }
  
  openFile() {
    window.open(this.fileUrl, '_blank');
  }
  
  /**
   * Download the file directly
   */
  downloadFile(event: Event) {
    event.stopPropagation();
    if (this.fileUrl) {
      const link = document.createElement('a');
      link.href = this.fileUrl;
      link.download = this.fileName;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }
  
  /**
   * Confirm and delete the file
   */
  async confirmDelete(event: Event) {
    event.stopPropagation();
    
    if (!this.fileId || !this.filePath) {
      return;
    }
    
    const alert = await this.alertController.create({
      header: 'Delete File',
      message: `Are you sure you want to delete ${this.fileName}?`,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => {
            this.deleteFile.emit({
              id: this.fileId,
              path: this.filePath
            });
          }
        }
      ]
    });
    
    await alert.present();
  }
}
