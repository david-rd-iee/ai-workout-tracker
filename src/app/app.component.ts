import { Component, OnInit } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';

import { DevSeedService } from './services/dev-seed.service';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  standalone: true,
  imports: [IonicModule, RouterModule],
})
export class AppComponent implements OnInit {
  constructor(private devSeedService: DevSeedService) {}

  async ngOnInit(): Promise<void> {
    if (!environment.production) {
      console.log('[AppComponent] Dev seeding starting...');
      try {
        await this.devSeedService.ensureDevUserAndSeed();
        console.log('[AppComponent] Dev seeding complete.');
      } catch (err) {
        console.error('[AppComponent] Dev seeding failed:', err);
      }
    } else {
      console.log('[AppComponent] Production mode - skipping dev seeding.');
    }
  }
}
