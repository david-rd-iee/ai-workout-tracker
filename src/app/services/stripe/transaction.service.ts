import { Injectable } from '@angular/core';
import { Firestore, collection, query, where, orderBy, limit, getDocs, addDoc, DocumentData } from '@angular/fire/firestore';
import { UserService } from '../account/user.service';

export interface Transaction {
  trainerId: string;
  clientId: string;
  paymentDate: Date;
  paymentId: string;
  agreementId: string;
  amount: number;
  status: string;
  clientName?: string;
  clientProfileImage?: string;
}

@Injectable({
  providedIn: 'root'
})
export class TransactionService {

  constructor(
    private firestore: Firestore,
    private userService: UserService
  ) { }

  /**
   * Record a new transaction in the database
   * @param transaction Transaction details
   * @returns Promise with the new transaction ID
   */
  async recordTransaction(transaction: Transaction): Promise<string> {
    try {
      const transactionsRef = collection(this.firestore, 'transactions');
      const docRef = await addDoc(transactionsRef, {
        ...transaction,
        paymentDate: transaction.paymentDate || new Date(),
        createdAt: new Date()
      });
      
      console.log('Transaction recorded with ID:', docRef.id);
      return docRef.id;
    } catch (error) {
      console.error('Error recording transaction:', error);
      throw error;
    }
  }

  /**
   * Get recent transactions for a trainer
   * @param trainerId The trainer's ID
   * @param limit Number of transactions to retrieve
   * @returns Promise with array of transactions
   */
  async getTrainerTransactions(trainerId: string, transactionLimit: number = 10): Promise<Transaction[]> {
    try {
      const transactionsRef = collection(this.firestore, 'transactions');
      const q = query(
        transactionsRef,
        where('trainerId', '==', trainerId),
        orderBy('paymentDate', 'desc'),
        limit(transactionLimit)
      );

      const querySnapshot = await getDocs(q);
      const transactions: Transaction[] = [];

      for (const doc of querySnapshot.docs) {
        const transaction = doc.data() as Transaction;
        
        // Get client name if available
        if (transaction.clientId) {
          try {
            const clientData = await this.userService.getUserProfileDirectly(transaction.clientId, 'client');
            if (clientData) {
              transaction.clientName = `${clientData.firstName || ''} ${clientData.lastName || ''}`.trim() || 'Unknown Client';
              transaction.clientProfileImage = clientData.profileImage;
            }
          } catch (error) {
            console.error('Error fetching client data:', error);
          }
        }
        
        transactions.push({
          ...transaction,
          paymentDate: transaction.paymentDate instanceof Date ? 
            transaction.paymentDate : 
            (transaction.paymentDate as any)?.toDate() || new Date()
        });
      }

      return transactions;
    } catch (error) {
      console.error('Error getting trainer transactions:', error);
      return [];
    }
  }

  /**
   * Get transactions for a specific client
   * @param clientId The client's ID
   * @param limit Number of transactions to retrieve
   * @returns Promise with array of transactions
   */
  async getClientTransactions(clientId: string, transactionLimit: number = 10): Promise<Transaction[]> {
    try {
      const transactionsRef = collection(this.firestore, 'transactions');
      const q = query(
        transactionsRef,
        where('clientId', '==', clientId),
        orderBy('paymentDate', 'desc'),
        limit(transactionLimit)
      );

      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => {
        const data = doc.data() as Transaction;
        return {
          ...data,
          paymentDate: data.paymentDate instanceof Date ? 
            data.paymentDate : 
            (data.paymentDate as any)?.toDate() || new Date()
        };
      });
    } catch (error) {
      console.error('Error getting client transactions:', error);
      return [];
    }
  }
}
