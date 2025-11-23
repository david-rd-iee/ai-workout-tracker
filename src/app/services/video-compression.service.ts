import { Injectable } from '@angular/core';

export interface CompressionProgress {
  stage: 'loading' | 'compressing' | 'complete';
  progress: number; // 0-100
  message: string;
}

@Injectable({
  providedIn: 'root'
})
export class VideoCompressionService {
  
  /**
   * Compress a video file using HTML5 MediaRecorder API
   * @param file Original video file
   * @param maxWidth Maximum width (height scaled proportionally)
   * @param targetBitrateMbps Target bitrate in Mbps
   * @param onProgress Callback for progress updates
   * @returns Compressed video file
   */
  async compressVideo(
    file: File,
    maxWidth: number = 1280,
    targetBitrateMbps: number = 2.5,
    onProgress?: (progress: CompressionProgress) => void
  ): Promise<File> {
    console.log('Starting video compression...');
    console.log('Original file:', file.name, (file.size / (1024 * 1024)).toFixed(2), 'MB');
    
    onProgress?.({ stage: 'loading', progress: 10, message: 'Loading video...' });
    
    try {
      // Create video element to read the source
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      
      // Load the video
      const videoUrl = URL.createObjectURL(file);
      video.src = videoUrl;
      
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = () => reject(new Error('Failed to load video'));
      });
      
      onProgress?.({ stage: 'loading', progress: 20, message: 'Analyzing video...' });
      
      // Calculate dimensions maintaining aspect ratio
      let width = video.videoWidth;
      let height = video.videoHeight;
      
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      
      console.log(`Compressing from ${video.videoWidth}x${video.videoHeight} to ${width}x${height}`);
      
      // Create canvas for video frames
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        throw new Error('Could not get canvas context');
      }
      
      onProgress?.({ stage: 'compressing', progress: 30, message: 'Compressing video...' });
      
      // Create MediaRecorder with optimized settings
      const stream = canvas.captureStream(30); // 30 fps
      const videoBitrate = targetBitrateMbps * 1000000; // Convert to bps
      
      const mimeType = this.getSupportedMimeType();
      console.log('Using MIME type:', mimeType);
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: videoBitrate
      });
      
      const chunks: Blob[] = [];
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };
      
      // Start recording
      mediaRecorder.start(100); // Collect data every 100ms
      
      // Play video and draw frames to canvas
      video.currentTime = 0;
      await video.play();
      
      const duration = video.duration;
      let lastProgress = 30;
      
      const drawFrame = () => {
        if (video.paused || video.ended) {
          return;
        }
        
        ctx.drawImage(video, 0, 0, width, height);
        
        // Update progress
        const currentProgress = 30 + Math.floor((video.currentTime / duration) * 60);
        if (currentProgress > lastProgress) {
          lastProgress = currentProgress;
          const percent = Math.floor((video.currentTime / duration) * 100);
          onProgress?.({ 
            stage: 'compressing', 
            progress: currentProgress,
            message: `Compressing... ${percent}%`
          });
        }
        
        requestAnimationFrame(drawFrame);
      };
      
      drawFrame();
      
      // Wait for video to finish
      await new Promise<void>((resolve) => {
        video.onended = () => {
          console.log('Video playback ended');
          resolve();
        };
      });
      
      // Stop recording
      mediaRecorder.stop();
      
      onProgress?.({ stage: 'compressing', progress: 95, message: 'Finalizing...' });
      
      // Wait for final data
      const compressedBlob = await new Promise<Blob>((resolve) => {
        mediaRecorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType });
          resolve(blob);
        };
      });
      
      // Clean up
      URL.revokeObjectURL(videoUrl);
      video.remove();
      canvas.remove();
      
      // Create compressed file
      const compressedFile = new File(
        [compressedBlob],
        file.name.replace(/\.[^/.]+$/, '') + '_compressed.mp4',
        { type: 'video/mp4' }
      );
      
      const originalSizeMB = file.size / (1024 * 1024);
      const compressedSizeMB = compressedFile.size / (1024 * 1024);
      const compressionRatio = ((1 - compressedFile.size / file.size) * 100).toFixed(1);
      
      console.log('Compression complete!');
      console.log(`Original: ${originalSizeMB.toFixed(2)} MB -> Compressed: ${compressedSizeMB.toFixed(2)} MB`);
      console.log(`Reduced by: ${compressionRatio}%`);
      
      onProgress?.({ 
        stage: 'complete', 
        progress: 100, 
        message: `Compressed by ${compressionRatio}%`
      });
      
      return compressedFile;
    } catch (error: any) {
      console.error('Video compression failed:', error);
      throw new Error(`Compression failed: ${error.message}`);
    }
  }
  
  /**
   * Get the best supported MIME type for video recording
   */
  private getSupportedMimeType(): string {
    const types = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4'
    ];
    
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    
    return 'video/webm'; // Fallback
  }
  
  /**
   * Check if video compression is supported in this browser
   */
  isCompressionSupported(): boolean {
    return !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream);
  }
}
