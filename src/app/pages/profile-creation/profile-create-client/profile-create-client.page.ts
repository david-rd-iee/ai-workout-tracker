import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonLabel, IonInput, IonButton, IonSelect, IonSelectOption, IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { UserService } from 'src/app/services/account/user.service';
import { trainerProfile } from 'src/app/Interfaces/Profiles/Trainer';
import { clientProfile } from 'src/app/Interfaces/Profiles/Client';
import { HeaderComponent } from "../../../components/header/header.component";
import { ROUTE_PATHS } from 'src/app/app.routes';
import { PhoneInputComponent } from 'src/app/components/phone-input/phone-input.component';
import { AutocorrectDirective } from 'src/app/directives/autocorrect.directive';
import { addIcons } from 'ionicons';
import { alertCircle } from 'ionicons/icons';

@Component({
  selector: 'app-profile-create-client',
  templateUrl: './profile-create-client.page.html',
  styleUrls: ['./profile-create-client.page.scss'],
  standalone: true,
  imports: [
    IonContent, CommonModule, FormsModule, ReactiveFormsModule,
    IonInput, IonButton, IonSelect, IonSelectOption, IonIcon, IonSpinner, HeaderComponent, PhoneInputComponent, AutocorrectDirective
  ]
})
export class ProfileCreateClientPage implements OnInit {
  clientForm!: FormGroup;
  isSubmitting = false;
  formSubmitted = false;

  constructor(
    private fb: FormBuilder, 
    private router: Router, 
    private userService: UserService
  ) {
    addIcons({ alertCircle });
  }

  ngOnInit() {
    const initialValues = {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      accountType: 'client',
      city: '',
      state: '',
      zip: '',
      goals: '',
      experience: '',
      description: ''
    };

    this.clientForm = this.fb.group({
      firstName: [initialValues.firstName, [Validators.required, Validators.minLength(2), Validators.maxLength(50)]],
      lastName: [initialValues.lastName, [Validators.required, Validators.minLength(2), Validators.maxLength(50)]],
      email: initialValues.email, // email will be got from the logged in user
      phone: [initialValues.phone, [Validators.required]],
      accountType: ['client', Validators.required],
      city: [initialValues.city, [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
      state: [initialValues.state, [Validators.required, Validators.minLength(2), Validators.maxLength(50)]],
      zip: [initialValues.zip, [Validators.required, Validators.pattern('^[0-9]{5}$')]],
      goals: [initialValues.goals],
      experience: [initialValues.experience],
      description: [initialValues.description]
    });
  }

  /**
   * Checks if there are any validation errors that should be displayed
   * Returns true if form has been submitted OR if any field has been touched and has errors
   */
  hasValidationErrors(): boolean {
    if (!this.clientForm) return false;
    
    // Check each field to see if it has errors
    const fields = ['firstName', 'lastName', 'phone', 'city', 'state', 'zip'];
    
    for (const field of fields) {
      const control = this.clientForm.get(field);
      // Show errors if form was submitted OR if field was touched/dirty
      if (control && control.errors && (this.formSubmitted || control.touched || control.dirty)) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Helper method to check if a specific field should show its error
   */
  shouldShowError(fieldName: string): boolean {
    const control = this.clientForm.get(fieldName);
    return !!(control && control.errors && (this.formSubmitted || control.touched || control.dirty));
  }

  onSubmit() {
    this.formSubmitted = true;
    
    if (!this.clientForm.valid) {
      this.isSubmitting = false;
      return;
    }
    
    this.isSubmitting = true;
    const formData: clientProfile = this.clientForm.value;
    
    this.userService.createUserProfile(formData)
      .then((data) => {
        console.log(data);
        // Try to link any partial profiles using phone number
        const phoneNumber = this.clientForm.get('phone')?.value;
        if (phoneNumber) {
          this.userService.linkProfileByPhone(phoneNumber);
        }
        // Make sure to reload the user profile before navigating
        return this.userService.loadUserProfile();
      })
      .then(() => {
          // Navigate to trainer finder page instead of home for clients
          this.router.navigate(['/app/tabs/trainer-finder']);
              })
      .catch((err) => {
        console.error(err);
        this.isSubmitting = false;
      });
  }

  onNameInput(event: any, fieldName: string) {
    const value = event.detail.value;
    // Check if user just typed a space (word completion)
    if (value.endsWith(' ')) {
      this.capitalizeField(fieldName, false);
    }
  }

  capitalizeField(fieldName: string, shouldTrim: boolean = true) {
    const control = this.clientForm.get(fieldName);
    if (control && control.value) {
      const capitalizedValue = this.capitalizeWords(control.value, shouldTrim);
      control.setValue(capitalizedValue, { emitEvent: false });
    }
  }

  private capitalizeWords(text: string, shouldTrim: boolean = true): string {
    const result = text
      .toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    
    return shouldTrim ? result.trim() : result;
  }

}
