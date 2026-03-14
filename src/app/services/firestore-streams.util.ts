import { Observable } from 'rxjs';
import {
  CollectionReference,
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Query,
  QueryDocumentSnapshot,
  onSnapshot,
} from 'firebase/firestore';

function withSnapshotId<T>(data: T, snapshotId: string, idField?: string): T {
  if (!idField || !data || typeof data !== 'object') {
    return data;
  }

  return {
    ...(data as object),
    [idField]: snapshotId,
  } as T;
}

export function watchDocumentData<T>(
  documentRef: DocumentReference<DocumentData>,
  options?: { idField?: string }
): Observable<T | undefined> {
  return new Observable<T | undefined>((subscriber) => {
    const unsubscribe = onSnapshot(
      documentRef,
      (snapshot: DocumentSnapshot<DocumentData>) => {
        if (!snapshot.exists()) {
          subscriber.next(undefined);
          return;
        }

        const data = snapshot.data() as T;
        subscriber.next(withSnapshotId(data, snapshot.id, options?.idField));
      },
      (error) => subscriber.error(error)
    );

    return () => unsubscribe();
  });
}

export function watchQueryData<T>(
  queryRef: Query<DocumentData> | CollectionReference<DocumentData>,
  options?: { idField?: string }
): Observable<T[]> {
  return new Observable<T[]>((subscriber) => {
    const unsubscribe = onSnapshot(
      queryRef,
      (snapshot) => {
        subscriber.next(
          snapshot.docs.map((docSnapshot: QueryDocumentSnapshot<DocumentData>) => {
            const data = docSnapshot.data() as T;
            return withSnapshotId(data, docSnapshot.id, options?.idField);
          })
        );
      },
      (error) => subscriber.error(error)
    );

    return () => unsubscribe();
  });
}
