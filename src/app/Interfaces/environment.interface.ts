export interface Environment {
  production: boolean;
  firebaseConfig: {
    apiKey: string;
    authDomain: string;
    databaseURL: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
    measurementId: string;
  };
  stripePublicKey: string;
  appUrl?: string; // Base URL for the application, used for payment redirects
  appVersion: string; // Current app version for force update checks
}
