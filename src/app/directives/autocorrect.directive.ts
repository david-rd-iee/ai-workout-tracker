import { Directive, ElementRef, OnInit } from '@angular/core';

@Directive({
  selector: 'ion-input, ion-textarea',
  standalone: true
})
export class AutocorrectDirective implements OnInit {
  constructor(private el: ElementRef) {}

  ngOnInit() {
    // Get the native element
    const nativeElement = this.el.nativeElement;
    
    // Add autocorrect attributes
    nativeElement.setAttribute('autocorrect', 'on');
    nativeElement.setAttribute('autocapitalize', 'on');
    nativeElement.setAttribute('spellcheck', 'true');
  }
}
