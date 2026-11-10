import { Pipe, PipeTransform } from '@angular/core';
import { formatMinor } from '../../../backend/src/domain/money';
import type { Currency } from '../../../backend/src/domain/types';

@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(minor: number | null | undefined, currency: Currency | string = 'EGP'): string {
    if (minor == null) return '—';
    return formatMinor(minor, currency as Currency);
  }
}
