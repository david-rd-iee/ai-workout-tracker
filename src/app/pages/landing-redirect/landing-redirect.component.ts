import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-landing-redirect',
  standalone: true,
  template: '',
})
export class LandingRedirectComponent implements OnInit {
  constructor(private router: Router) {}

  ngOnInit(): void {
    const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
    const target = hostname === 'atlas-ai-demo.web.app' ? '/demo-setup' : '/login';

    void this.router.navigateByUrl(target, { replaceUrl: true });
  }
}
