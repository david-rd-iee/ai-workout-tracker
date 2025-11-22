import { Injectable } from '@angular/core';
import { doc, getDoc, Firestore } from '@angular/fire/firestore';
import { environment } from 'src/environments/environment';
@Injectable({
  providedIn: 'root'
})
export class AppVersionService {
  constructor(private firestore: Firestore) { 
    
  }

  async checkVersion(): Promise<boolean> {
    try {
      // Get the version document from Firestore at /version/latest
      const versionDocRef = doc(this.firestore, 'version', 'latest');
      const versionDoc = await getDoc(versionDocRef);
      
      if (!versionDoc.exists()) {
        console.warn('Version document not found in Firestore');
        return false; // No update needed if document doesn't exist
      }
      
      const requiredVersion = versionDoc.data()?.['version'];
      const currentVersion = environment.appVersion;
      
      console.log('Current app version:', currentVersion);
      console.log('Required version:', requiredVersion);
      
      // Return true if update is needed (versions don't match)
      return requiredVersion !== currentVersion;
    } catch (error) {
      console.error('Error checking app version:', error);
      return false; // Don't force update on error
    }
  }
}
