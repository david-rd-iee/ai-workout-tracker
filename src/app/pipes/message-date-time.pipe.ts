import { Pipe, PipeTransform } from '@angular/core';
import { formatDate } from '@angular/common';

@Pipe({
  name: 'messageDateTime',
  standalone: true
})
export class MessageDateTimePipe implements PipeTransform {

  transform(value: string): unknown {
    const date = new Date(value);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    if (this.isSameDay(date, today)) {
      return formatDate(date, 'shortTime', 'en-US');
    } else if (this.isSameDay(date, yesterday)) {
      return 'Yesterday';
    } else {
      return formatDate(date, 'shortDate', 'en-US');
    }
  }

     
  
  private isSameDay(date1: Date, date2: Date): boolean {
    return date1.getFullYear() === date2.getFullYear() &&
            date1.getMonth() === date2.getMonth() &&
            date1.getDate() === date2.getDate();
  }
}
