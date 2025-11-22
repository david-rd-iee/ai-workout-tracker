import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon, IonButton } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, chatbubbleEllipsesOutline } from 'ionicons/icons';

@Component({
  selector: 'app-tool-tip',
  templateUrl: './tool-tip.component.html',
  styleUrls: ['./tool-tip.component.scss'],
  standalone: true,
  imports: [CommonModule, IonIcon, IonButton]
})
export class ToolTipComponent {
  @Input() text: string = '';
  @Input() showIcon: boolean = true;
  @Output() close = new EventEmitter<void>();

  constructor() {
    addIcons({
      closeOutline,
      chatbubbleEllipsesOutline
    });
  }

  onClose() {
    this.close.emit();
  }
}
