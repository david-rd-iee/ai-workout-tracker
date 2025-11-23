import { Injectable } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';

@Injectable({
  providedIn: 'root'
})
export class TwilioService {
    constructor(private functions: Functions) {}

    async sendTwilioMessage(chatId: string, senderType: "trainer" | "client", from: string, to: string, body: string): Promise<void> {
        try {
            const sendTwilioMessageFn = httpsCallable(this.functions, 'sendTwilioMessage');
            const result = await sendTwilioMessageFn({
                chatId,
                senderType,
                from,
                to,
                body
            });
            
            console.log('Twilio message sent:', result.data);
        } catch (error) {
            console.error('Error sending Twilio message:', error);
            throw error;
        }
    }
}
