import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'phoneFormat',
  standalone: true
})
export class PhoneFormatPipe implements PipeTransform {

  transform(phoneNumber: string | null): string {
    if (!phoneNumber) return '';
    
    // Strip all non-numeric characters
    const cleaned = phoneNumber.replace(/\D/g, '');
    
    // Handle case where country code might be present (e.g., +1)
    let digits = cleaned;
    if (cleaned.length > 10) {
      // If we have more than 10 digits, take the last 10
      digits = cleaned.substring(cleaned.length - 10);
    } else if (cleaned.length !== 10) {
      // If we don't have exactly 10 digits and not more, return original
      return phoneNumber;
    }
    
    // Format as (XXX)-XXX-XXXX
    return `(${digits.substring(0, 3)})-${digits.substring(3, 6)}-${digits.substring(6, 10)}`;
  }
}
