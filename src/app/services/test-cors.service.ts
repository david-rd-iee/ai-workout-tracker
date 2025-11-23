import { inject, Injectable } from '@angular/core';
import { Functions, getFunctions, httpsCallable } from '@angular/fire/functions';

@Injectable({
  providedIn: 'root'
})
export class TestCorsService {
  private functions = inject(Functions);
  
  constructor() { }

  /**
   * Call the test CORS function to verify Firebase Functions connectivity
   * @param testData Any test data to send to the function
   * @returns Promise with the response from the function
   */
  async callTestCorsFunction(testData: any = { test: true }): Promise<any> {
    try {
      console.log('Calling testCors function with data:', testData);
      
      // Use the injected Functions service instead of creating a new one
      // This ensures we're using the properly configured instance
      
      // Create the callable function reference
      const testCorsFunction = httpsCallable(this.functions, 'testCors');
      
      // Make the function call
      console.log('Sending request to testCors function...');
      const result = await testCorsFunction(testData);
      
      console.log('Received response from testCors function:', result);
      return result.data;
    } catch (error) {
      console.error('Error calling testCors function:', error);
      throw error;
    }
  }
}
