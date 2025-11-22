import { Component, Input, OnInit, ElementRef, Renderer2 } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-background-gradients',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './background-gradients.component.html',
  styleUrls: ['./background-gradients.component.scss']
})
export class BackgroundGradientsComponent implements OnInit {
  @Input() position: 'top' | 'bottom' | 'both' = 'both';
  @Input() primaryColor: string = '#D8EFFF';
  @Input() secondaryColor: string = '#FFE8DA';
  @Input() topSize: number = 300; // Size in pixels
  @Input() bottomSize: number = 400; // Size in pixels
  @Input() topPosition: { x: number, y: number } = { x: -100, y: -150 }; // Position offset
  @Input() bottomPosition: { x: number, y: number } = { x: -100, y: -150 }; // Position offset
  
  constructor(private el: ElementRef, private renderer: Renderer2) {}
  
  ngOnInit() {
    // Apply CSS variables to the host element
    this.renderer.setStyle(this.el.nativeElement, '--primary-color', this.primaryColor);
    this.renderer.setStyle(this.el.nativeElement, '--secondary-color', this.secondaryColor);
    this.renderer.setStyle(this.el.nativeElement, '--top-size', `${this.topSize}px`);
    this.renderer.setStyle(this.el.nativeElement, '--bottom-size', `${this.bottomSize}px`);
    this.renderer.setStyle(this.el.nativeElement, '--top-x', `${this.topPosition.x}px`);
    this.renderer.setStyle(this.el.nativeElement, '--top-y', `${this.topPosition.y}px`);
    this.renderer.setStyle(this.el.nativeElement, '--bottom-x', `${this.bottomPosition.x}px`);
    this.renderer.setStyle(this.el.nativeElement, '--bottom-y', `${this.bottomPosition.y}px`);
  }
}
