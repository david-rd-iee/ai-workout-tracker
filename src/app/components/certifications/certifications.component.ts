import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core';
import { 
  IonModal, 
  IonIcon, 
  IonButton, 
  IonChip, 
  IonLabel, 
  IonList, 
  IonItem,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonFooter,
  IonButtons
} from '@ionic/angular/standalone';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { addOutline, closeCircleOutline, checkmarkCircleOutline } from 'ionicons/icons';
import { addIcons } from 'ionicons';

@Component({
  selector: 'app-certifications',
  templateUrl: './certifications.component.html',
  styleUrls: ['./certifications.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonIcon,
    IonChip,
    IonLabel,
    FormsModule
  ]
})
export class CertificationsComponent implements OnInit {
  @Input() education: string[] = [];
  // @Output() selectedCertsChange = new EventEmitter<string[]>();
  
  certificationMap: { [key: string]: string } = {
  };


  constructor() {
    addIcons({
      addOutline,
      closeCircleOutline,
      checkmarkCircleOutline
    });
   }


  ngOnInit() {}

}
