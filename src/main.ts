import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import {
  RouteReuseStrategy,
  provideRouter,
  withPreloading,
  PreloadAllModules,
} from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular/standalone';
import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';
import { environment } from './environments/environment';
import { appNavAnimation } from './app/animations/nav-animation';

import { provideFirebaseApp, initializeApp, getApp } from '@angular/fire/app';
import {
  provideAuth,
  getAuth,
  initializeAuth,
  indexedDBLocalPersistence,
  browserSessionPersistence,
} from '@angular/fire/auth';
import { provideFirestore, getFirestore } from '@angular/fire/firestore';
import { provideAnalytics, getAnalytics } from '@angular/fire/analytics';
import { FIREBASE_OPTIONS } from '@angular/fire/compat';
import { Capacitor } from '@capacitor/core';
import { getDatabase, provideDatabase } from '@angular/fire/database';
import { getStorage, provideStorage } from '@angular/fire/storage';
import { getFunctions, provideFunctions } from '@angular/fire/functions';

import { provideHttpClient } from '@angular/common/http';
// Register Swiper web components
import { register } from 'swiper/element/bundle';
register();
bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    { provide: FIREBASE_OPTIONS, useValue: environment.firebaseConfig },
    provideIonicAngular({ mode: 'ios', navAnimation: appNavAnimation }),
    provideRouter(routes, withPreloading(PreloadAllModules)),
    provideFirebaseApp(() => initializeApp(environment.firebaseConfig)),
    provideFirestore(() => getFirestore()),
    provideDatabase(() => getDatabase()),
    provideStorage(() => getStorage()),
    provideAnalytics(() => getAnalytics()),
    provideAnimations(),
    provideFunctions(() => getFunctions(undefined, 'us-west1')),
    provideAuth(() => {
      if (Capacitor.isNativePlatform()) {
        return initializeAuth(getApp(), {
          persistence: indexedDBLocalPersistence,
        });
      } else {
        return initializeAuth(getApp(), {
          persistence: browserSessionPersistence,
        });
      }
    }),

    provideHttpClient(),
  ],
});
