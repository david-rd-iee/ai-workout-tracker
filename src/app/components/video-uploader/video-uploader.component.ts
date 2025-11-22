import { Component, EventEmitter, Input, Output, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { videocam, cloudUploadOutline, videocamOutline, closeCircle } from 'ionicons/icons';
import { addIcons } from 'ionicons';
import { AlertController } from '@ionic/angular/standalone';

@Component({
  selector: 'app-video-uploader',
  templateUrl: './video-uploader.component.html',
  styleUrls: ['./video-uploader.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class VideoUploaderComponent {
  @Input() currentVideoUrl: string = '';
  @Output() videoSelected = new EventEmitter<File>();
  @Output() videoRemoved = new EventEmitter<void>();

  previewUrl: string | null = null;
  videoDuration: number = 0;
  
  // Video constraints
  readonly MAX_DURATION_SECONDS = 120; // 2 minutes
  readonly RECOMMENDED_FILE_SIZE_MB = 15; // Auto-compress videos above this size
  readonly ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-m4v'];

  constructor(
    private alertController: AlertController,
    private cdr: ChangeDetectorRef
  ) { 
    addIcons({ 
      videocam, 
      'cloud-upload': cloudUploadOutline,
      'videocam-outline': videocamOutline,
      'close-circle': closeCircle
    });
  }
  
  /**
   * Handle video selection from file input (web)
   */
  async selectVideo(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      
      // Validate file type
      if (!this.ACCEPTED_VIDEO_TYPES.includes(file.type)) {
        await this.showAlert('Invalid File Type', 'Please select a valid video file (MP4, MOV, or M4V).');
        input.value = '';
        return;
      }
      
      // Validate video duration
      const isValid = await this.validateVideoDuration(file);
      if (!isValid) {
        input.value = '';
        return;
      }
      
      const fileSizeMB = file.size / (1024 * 1024);
      console.log(`Selected video: ${file.name}, Size: ${fileSizeMB.toFixed(2)} MB`);
      
      // Create preview using URL.createObjectURL
      this.previewUrl = URL.createObjectURL(file);
      console.log('Preview URL created:', this.previewUrl);
      
      // Trigger change detection to update the view
      this.cdr.detectChanges();
      
      // Emit the original file to parent (compression will happen on save)
      this.videoSelected.emit(file);
      
      // Reset input value so the same file can be selected again
      input.value = '';
    }
  }

  /**
   * Validate video duration
   */
  private async validateVideoDuration(file: File): Promise<boolean> {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      
      video.onloadedmetadata = async () => {
        window.URL.revokeObjectURL(video.src);
        const duration = Math.floor(video.duration);
        this.videoDuration = duration;
        
        if (duration > this.MAX_DURATION_SECONDS) {
          await this.showAlert(
            'Video Too Long', 
            `Video duration must be ${this.MAX_DURATION_SECONDS / 60} minutes or less. Your video is ${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')} minutes.`
          );
          resolve(false);
        } else {
          resolve(true);
        }
      };
      
      video.onerror = async () => {
        await this.showAlert('Invalid Video', 'Unable to read video file. Please try another file.');
        resolve(false);
      };
      
      video.src = URL.createObjectURL(file);
    });
  }

  /**
   * Trigger file selection - use file input for both web and mobile
   * Mobile devices will open their native video picker
   */
  async triggerFileInput() {
    document.getElementById('videoFileInput')?.click();
  }

  /**
   * Remove the selected video
   */
  removeVideo() {
    // Revoke the object URL to free up memory
    if (this.previewUrl && this.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.previewUrl);
    }
    this.previewUrl = null;
    this.videoDuration = 0;
    this.videoRemoved.emit();
  }

  /**
   * Show alert dialog
   */
  private async showAlert(header: string, message: string) {
    const alert = await this.alertController.create({
      header,
      message,
      buttons: ['OK']
    });
    await alert.present();
  }

  /**
   * Format duration in MM:SS format
   */
  formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }
}
