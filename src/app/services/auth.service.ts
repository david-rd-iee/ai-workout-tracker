import { Injectable } from '@angular/core';
import { Auth, authState, User as FirebaseUser } from '@angular/fire/auth';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  user$: Observable<FirebaseUser | null>;

  constructor(private auth: Auth) {
    this.user$ = authState(this.auth);
  }

  // You can add login/logout helpers later
}
