import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { ModalController, IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonButton, IonItem, IonLabel, IonInput, IonText, IonIcon, LoadingController, ToastController } from '@ionic/angular/standalone';
import { CommonModule } from '@angular/common';
import { AccountService } from '../../services/account/account.service';
import { addIcons } from 'ionicons';
import { eyeOutline, eyeOffOutline, closeOutline } from 'ionicons/icons';

@Component({
  selector: 'app-password-change-modal',
  templateUrl: './password-change-modal.component.html',
  styleUrls: ['./password-change-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonButton,
    IonItem,
    IonInput,
    IonText,
    IonIcon
  ]
})
export class PasswordChangeModalComponent implements OnInit {
  passwordForm: FormGroup;
  passwordError: string = '';
  showCurrentPassword: boolean = false;
  showNewPassword: boolean = false;
  showConfirmPassword: boolean = false;

  constructor(
    private formBuilder: FormBuilder,
    private modalCtrl: ModalController,
    private accountService: AccountService,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController
  ) {
    this.passwordForm = this.formBuilder.group({
      currentPassword: ['', [Validators.required]],
      newPassword: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]]
    }, { validators: this.passwordMatchValidator });
    
    // Register the icons
    addIcons({
      'eye-outline': eyeOutline,
      'eye-off-outline': eyeOffOutline,
      'close-outline': closeOutline
    });
  }

  ngOnInit() {}

  // Custom validator to check if password and confirm password match
  passwordMatchValidator(g: FormGroup) {
    const newPassword = g.get('newPassword')?.value;
    const confirmPassword = g.get('confirmPassword')?.value;
    return newPassword === confirmPassword ? null : { mismatch: true };
  }

  togglePasswordVisibility(field: 'current' | 'new' | 'confirm') {
    if (field === 'current') {
      this.showCurrentPassword = !this.showCurrentPassword;
    } else if (field === 'new') {
      this.showNewPassword = !this.showNewPassword;
    } else {
      this.showConfirmPassword = !this.showConfirmPassword;
    }
  }

  async changePassword() {
    if (this.passwordForm.invalid) {
      // Mark all fields as touched to show validation errors
      Object.keys(this.passwordForm.controls).forEach(key => {
        this.passwordForm.get(key)?.markAsTouched();
      });
      return;
    }

    // Check if passwords match
    if (this.passwordForm.hasError('mismatch')) {
      this.passwordError = 'New password and confirm password do not match';
      return;
    }

    const currentPassword = this.passwordForm.get('currentPassword')?.value;
    const newPassword = this.passwordForm.get('newPassword')?.value;

    // Show loading indicator
    const loading = await this.loadingCtrl.create({
      message: 'Changing password...'
    });
    await loading.present();

    try {
      const result = await this.accountService.changePassword(currentPassword, newPassword);
      
      await loading.dismiss();
      
      if (result.success) {
        const toast = await this.toastCtrl.create({
          message: 'Password changed successfully',
          duration: 2000,
          color: 'success',
          position: 'bottom'
        });
        await toast.present();
        this.modalCtrl.dismiss(true);
      } else {
        this.passwordError = result.message;
      }
    } catch (error) {
      await loading.dismiss();
      this.passwordError = 'An error occurred while changing your password';
      console.error('Password change error:', error);
    }
  }

  cancel() {
    this.modalCtrl.dismiss(false);
  }
}
