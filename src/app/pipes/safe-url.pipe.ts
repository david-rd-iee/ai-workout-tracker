import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

@Pipe({
    name: 'safeUrl'
  })
export class SafeUrlPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}
  
  transform(url: string | null | undefined) {
    const normalizedUrl = String(url || '').trim();
    if (!this.isTrustedUrl(normalizedUrl)) {
      return null;
    }

    return this.sanitizer.bypassSecurityTrustResourceUrl(normalizedUrl);
  }

  private isTrustedUrl(url: string): boolean {
    if (!url) {
      return false;
    }

    if (url.startsWith('blob:') || url.startsWith('data:image/')) {
      return true;
    }

    try {
      const parsed = new URL(url, window.location.origin);
      if (parsed.origin === window.location.origin) {
        return true;
      }

      return (
        parsed.protocol === 'https:' &&
        (parsed.hostname === 'firebasestorage.googleapis.com' ||
          parsed.hostname === 'storage.googleapis.com')
      );
    } catch {
      return false;
    }
  }
}
