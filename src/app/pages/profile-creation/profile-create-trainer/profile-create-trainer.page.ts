import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { IonContent, IonInput, IonButton, IonIcon, IonSpinner, IonTextarea } from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { UserService } from 'src/app/services/account/user.service';
import { trainerProfile } from 'src/app/Interfaces/Profiles/trainer';
import { ROUTE_PATHS } from 'src/app/app.routes';
import { PhoneInputComponent } from 'src/app/components/phone-input/phone-input.component';
// import { AutocorrectDirective } from 'src/app/directives/autocorrect.directive';
import { HeaderComponent } from 'src/app/components/header/header.component';
import { addIcons } from 'ionicons';
import { alertCircle } from 'ionicons/icons';

@Component({
  selector: 'app-profile-create-trainer',
  templateUrl: './profile-create-trainer.page.html',
  styleUrls: ['./profile-create-trainer.page.scss'],
  standalone: true,
  imports: [
    IonContent, CommonModule, FormsModule, ReactiveFormsModule,
    IonInput, IonButton, IonIcon, IonSpinner, IonTextarea, PhoneInputComponent, /* AutocorrectDirective, */ HeaderComponent
  ]
})
export class ProfileCreateTrainerPage implements OnInit {
  trainerForm!: FormGroup;
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
    this.trainerForm = this.fb.group({
      firstName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(50)]],
      lastName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(50)]],
      email: '', // email will be got from the logged in user
      phone: ['', [Validators.required]],
      specialization: ['', [Validators.required, Validators.maxLength(100)]],
      experience: ['', [Validators.required, Validators.min(0), Validators.max(100)]],
      education: ['', [Validators.required, Validators.maxLength(200)]],
      description: ['', [Validators.required, Validators.minLength(20), Validators.maxLength(2000)]],
      accountType: ['trainer', Validators.required],
      city: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
      state: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(50)]],
      zip: ['', [Validators.required, Validators.pattern('^[0-9]{5}$')]],
      visible: [false, Validators.required],
    });
  }

  /**
   * Checks if there are any validation errors that should be displayed
   * Returns true if form has been submitted OR if any field has been touched and has errors
   */
  hasValidationErrors(): boolean {
    if (!this.trainerForm) return false;

    // Check each field to see if it has errors
    const fields = ['firstName', 'lastName', 'phone', 'specialization', 'experience', 'education', 'description', 'city', 'state', 'zip'];

    for (const field of fields) {
      const control = this.trainerForm.get(field);
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
    const control = this.trainerForm.get(fieldName);
    return !!(control && control.errors && (this.formSubmitted || control.touched || control.dirty));
  }

  onSubmit() {
    this.formSubmitted = true;
    
    if (!this.trainerForm.valid) {
      this.isSubmitting = false;
      return;
    }
    this.isSubmitting = true;
    const formData: trainerProfile = this.trainerForm.value;
    this.userService.createUserProfile(formData)
      .then((data) => {
        console.log(data);
        this.router.navigate([ROUTE_PATHS.APP.TABS.HOME]);
      })
      .catch((err) => {
        console.error(err);
        this.isSubmitting = false;
      });
  }
}