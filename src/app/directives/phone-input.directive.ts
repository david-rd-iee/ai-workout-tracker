import { Directive, HostListener, Self, Optional, OnInit } from '@angular/core';
import { NgControl, ValidatorFn, AbstractControl, ValidationErrors, Validators } from '@angular/forms';

@Directive({
  selector: '[phoneInput]',
  standalone: true
})
export class PhoneInputDirective implements OnInit {
  private originalValidators: ValidatorFn[] = [];

  constructor(
    @Self() @Optional() private ngControl: NgControl
  ) {}

  ngOnInit(): void {
    if (!this.ngControl || !this.ngControl.control) return;
    
    // Store original validators
    this.originalValidators = this.ngControl.control.validator ? 
      [this.ngControl.control.validator] : [];
    
    // Create a custom validator that works with our phone input
    const phoneValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
      const value = control.value;
      if (!value) return null; // Let required validator handle empty values
      
      // Check if the value is exactly 10 digits
      const isValid = /^\d{10}$/.test(value);
      return isValid ? null : { 'pattern': true };
    };
    
    // Set the new validators
    const newValidators = [...this.originalValidators, phoneValidator];
    this.ngControl.control.setValidators(newValidators);
    this.ngControl.control.updateValueAndValidity();
  }

  @HostListener('input', ['$event'])
  onInput(event: InputEvent): void {
    if (!this.ngControl || !this.ngControl.control) return;
    
    const input = event.target as HTMLInputElement;
    const value = input.value;
    
    // Strip all non-numeric characters
    const cleaned = value.replace(/\D/g, '');
    
    // Handle case where country code might be present (e.g., +1)
    let digits = cleaned;
    if (cleaned.length > 10) {
      // If we have more than 10 digits, take the last 10
      digits = cleaned.substring(cleaned.length - 10);
    }
    
    // Only update the model if the value is different
    if (digits !== this.ngControl.value) {
      // Update the form control value with just the digits
      this.ngControl.control.setValue(digits, { emitEvent: true });
      
      // Trigger validation
      this.ngControl.control.updateValueAndValidity();
    }
  }
}
