import { Injectable, signal } from '@angular/core';
import { Firestore, collection, doc, getDoc, setDoc, query, where, getDocs } from '@angular/fire/firestore';
import { trainerProfile } from '../Interfaces/Profiles/trainer';
import { BehaviorSubject, Observable } from 'rxjs';


@Injectable({
  providedIn: 'root'
})
export class TrainerFinderService {
  private trainerSearchResults$ = new BehaviorSubject<trainerProfile[]>([]);
  //use this for saving the image and name when going to chats or other services after finding a trainer with trainer finder
  private selectedTrainer = signal<trainerProfile | null>(null);

  constructor(private firestore: Firestore) {}

  // Update trainer's advanced profile information
  async updateTrainerDetails(userId: string, profileUpdates: Partial<trainerProfile>): Promise<void> {
    const trainerRef = doc(this.firestore, `trainers/${userId}`);
    await setDoc(trainerRef, profileUpdates, { merge: true });
    await this.updateSearchIndex(userId, profileUpdates);
  }

  // Maintain search index
  private async updateSearchIndex(userId: string, profile: Partial<trainerProfile>): Promise<void> {
    const searchData: Partial<trainerProfile> = {
      id: userId,
      firstName: profile.firstName,
      lastName: profile.lastName,
      profileImage: profile.profileImage,
      specialization: profile.specialization,
      city: profile.city,
      state: profile.state,
      zip: profile.zip,
      trainingLocation: profile.trainingLocation,
      hourlyRate: profile.hourlyRate,
      visible: profile.visible
    };

    await setDoc(doc(this.firestore, 'trainers', userId), searchData, { merge: true });
  }

  // Search trainers by criteria
  async searchTrainers(criteria: {
    zip?: number,
    specialization?: string[],
    remote?: boolean,
    inPerson?: boolean,
    page?: number,
    pageSize?: number
  }): Promise<trainerProfile[]> {
    const trainersRef = collection(this.firestore, 'trainers');
    let q = query(trainersRef);

    // Temporarily removing server-side visibility filter while index is building
    // We'll filter on the client side instead

    // Add your query conditions
    if (criteria.zip) {
      q = query(q, where('zip', '==', criteria.zip));
    }
    if (criteria.specialization?.length) {
      q = query(q, where('specialization', 'array-contains-any', criteria.specialization));
    }
    if (criteria.remote !== undefined) {
      q = query(q, where('trainingLocation.remote', '==', criteria.remote));
    }
    if (criteria.inPerson !== undefined) {
      q = query(q, where('trainingLocation.inPerson', '==', criteria.inPerson));
    }

    try {
      const snapshot = await getDocs(q);
      let results = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as trainerProfile[];

      // Filter out trainers that are explicitly marked as not visible
      results = results.filter(trainer => trainer.visible !== false);

      // Handle pagination
      const start = (criteria.page || 0) * (criteria.pageSize || 10);
      const end = start + (criteria.pageSize || 10);
      results = results.slice(start, end);

      console.log('Firestore results:', results); // Debug log
      
      this.trainerSearchResults$.next(results);
      return results;
    } catch (error) {
      console.error('Error fetching trainers:', error);
      return [];
    }
  }

  // Get trainer search results as observable
  getSearchResults$(): Observable<trainerProfile[]> {
    return this.trainerSearchResults$.asObservable();
  }

  // Set selected trainer
  setChosenTrainer(trainer: trainerProfile): void {
    this.selectedTrainer.set(trainer);
  }

  getChosenTrainer() {
    return this.selectedTrainer;
  }
  
  // Get detailed trainer profile
  async getTrainerDetails(trainerId: string): Promise<trainerProfile | null> {
    const trainerRef = doc(this.firestore, `trainers/${trainerId}`);
    const trainerDoc = await getDoc(trainerRef);
    return trainerDoc.exists() ? (trainerDoc.data() as trainerProfile) : null;
  }
}
