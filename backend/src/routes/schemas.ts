import { Type } from '@sinclair/typebox';

export const PaymentKind = Type.Union([Type.Literal('credit_transfer'), Type.Literal('bill_payment'), Type.Literal('instant_credit')]);
export const Currency = Type.Union([Type.Literal('EGP'), Type.Literal('USD'), Type.Literal('SAR'), Type.Literal('AED')]);

export const CreatePaymentBody = Type.Object({
  kind: PaymentKind,
  amount: Type.String({ description: 'Decimal amount, e.g. "12500.50"' }),
  currency: Currency,
  debtorName: Type.String({ minLength: 1 }),
  debtorIban: Type.String({ minLength: 8 }),
  creditorName: Type.String({ minLength: 1 }),
  creditorIban: Type.String({ minLength: 8 }),
  reference: Type.String({ minLength: 1 }),
  narrative: Type.Optional(Type.String()),
  purpose: Type.Optional(Type.String()),
});

export const NoteBody = Type.Object({ note: Type.Optional(Type.String()) });
export const FailBody = Type.Object({ reason: Type.Optional(Type.String()) });

export const NormalizeBody = Type.Object({
  name: Type.String(),
  otherName: Type.Optional(Type.String()),
  iban: Type.Optional(Type.String()),
});
