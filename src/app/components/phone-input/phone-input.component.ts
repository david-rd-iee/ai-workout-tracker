import { Component, forwardRef, Input, OnInit } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, NG_VALIDATORS, FormControl, Validator, ValidationErrors, AbstractControl } from '@angular/forms';
import { IonInput } from '@ionic/angular/standalone';
import { CommonModule } from '@angular/common';
import { PhoneFormatPipe } from 'src/app/pipes/phone-format.pipe';

@Component({
  selector: 'app-phone-input',
  standalone: true,
  imports: [CommonModule, IonInput, PhoneFormatPipe],
  template: `
    <ion-input
      [label]="label"
      labelPlacement="stacked"
      type="tel"
      [placeholder]="placeholder"
      autocomplete="tel"
      inputmode="tel"
      [value]="displayValue"
      (ionInput)="onInput($event)"
      fill="outline"
      class="modern-input"
    ></ion-input>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
    }
    
    ion-input {
      --background: #ffffff;
      --border-color: #e2e8f0;
      --border-radius: 12px;
      --border-width: 1.5px;
      --highlight-color-focused: #3b82f6;
      --color: #1e293b;
      --placeholder-color: #94a3b8;
      --padding-start: 16px;
      --padding-end: 16px;
      --min-height: 56px;
      
      width: 100%;
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
      transition: all 0.2s ease-in-out;
      margin-bottom: 0;
    }

    ion-input:hover {
      --border-color: #cbd5e1;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    ion-input.ion-focused {
      --border-color: #3b82f6;
      --border-width: 2px;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }
    
    .format-hint {
      font-size: 0.8rem;
      color: var(--ion-color-medium);
      margin-top: 4px;
      margin-left: 16px;
    }
  `],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => PhoneInputComponent),
      multi: true
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => PhoneInputComponent),
      multi: true
    }
  ]
})
export class PhoneInputComponent implements ControlValueAccessor, Validator, OnInit {
  @Input() label: string = 'Phone Number';
  @Input() placeholder: string = 'Enter 10 digits (e.g. 7025890855)';

  value: string = '';
  displayValue: string = '';
  disabled: boolean = false;
  touched: boolean = false;

  private phoneFormatPipe = new PhoneFormatPipe();

  onChange: any = () => { };
  onTouched: any = () => { };

  ngOnInit(): void {
    // Initialize display value
    this.updateDisplayValue();
  }

  onInput(event: any): void {
    const input = event.target.value;

    // Strip all non-numeric characters
    const cleaned = input.replace(/\D/g, '');

    // Handle case where country code might be present (e.g., +1)
    let digits = cleaned;
    if (cleaned.length > 10) {
      // If we have more than 10 digits, take the last 10
      digits = cleaned.substring(cleaned.length - 10);
    }

    // Update internal value
    this.value = digits;

    // Update the display value
    this.updateDisplayValue();

    // Notify Angular forms
    this.onChange(this.value);
    this.markAsTouched();
  }

  // Update the display value based on the current value
  private updateDisplayValue(): void {
    this.displayValue = this.value ? this.phoneFormatPipe.transform(this.value) : '';
  }

  // ControlValueAccessor methods
  writeValue(value: string): void {
    if (value === null || value === undefined) {
      this.value = '';
    } else {
      // Strip non-digits and take last 10 digits if longer
      const cleaned = value.replace(/\D/g, '');
      this.value = cleaned.length > 10 ?
        cleaned.substring(cleaned.length - 10) : cleaned;
    }

    this.updateDisplayValue();
  }

  registerOnChange(fn: any): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  markAsTouched(): void {
    if (!this.touched) {
      this.onTouched();
      this.touched = true;
    }
  }

  // Validator methods
  validate(control: AbstractControl): ValidationErrors | null {
    // Required validation is handled by the form control
    if (!control.value) return null;

    // Check if the value is exactly 10 digits
    const isValid = /^\d{10}$/.test(control.value);
    return isValid ? null : { 'phoneFormat': true };
  }
}
