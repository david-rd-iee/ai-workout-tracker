// src/app/app.component.ts
import { Component, OnInit } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { DevSeedService } from './services/dev-seed.service';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent implements OnInit {

  constructor(private devSeedService: DevSeedService) {}

  async ngOnInit() {
    console.log('[AppComponent] ngOnInit');

    if (!environment.production) {
      console.log('[AppComponent] Running dev seed...');
      try {
        await this.devSeedService.ensureDevUserAndSeed();
        console.log('[AppComponent] Dev seed finished.');
      } catch (err) {
        console.error('[AppComponent] Dev seed failed:', err);
      }
    } else {
      console.log('[AppComponent] Skipping dev seed (production env).');
    }
  }
}
