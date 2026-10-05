import Stripe from 'stripe';
import { db } from '../../../prisma/db.js';

type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELED' | 'REFUNDED';

type CheckoutPlan = {
  mode: 'subscription' | 'payment';
  amountCents: number;
  lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];
};

const stripeKey = process.env['STRIPE_SECRET_KEY'];
const stripe = stripeKey ? new Stripe(stripeKey) : null;

function requireStripe() {
  if (!stripe) throw new Error('STRIPE_NOT_CONFIGURED');
  return stripe;
}

function centsToDecimal(amountCents: number): string {
  return (amountCents / 100).toFixed(2);
}

function decimalToCents(amount: string): number {
  return Math.round(Number(amount) * 100);
}

function readStripeId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value && typeof value === 'object' && 'id' in value && typeof (value as { id: unknown }).id === 'string') {
    return (value as { id: string }).id;
  }
  return null;
}

function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  if (from === to) return false;
  if (to === 'PAID' && from === 'PENDING') return true;
  if (to === 'FAILED' && (from === 'PENDING' || from === 'PAID')) return true;
  if (to === 'CANCELED' && from === 'PENDING') return true;
  if (to === 'REFUNDED' && from === 'PAID') return true;
  return false;
}

async function resolveCheckoutPlan(client: Stripe): Promise<CheckoutPlan> {
  const priceId = process.env['STRIPE_PRICE_ID'];
  if (priceId) {
    const price = await client.prices.retrieve(priceId);
    if (!price.unit_amount || !Number.isInteger(price.unit_amount) || price.unit_amount < 100) {
      throw new Error('STRIPE_PRICE_INVALID');
    }
    return {
      mode: price.type === 'recurring' ? 'subscription' : 'payment',
      amountCents: price.unit_amount,
      lineItems: [{ price: priceId, quantity: 1 }],
    };
  }

  const amountCents = Number(process.env['STRIPE_MAINTENANCE_AMOUNT_CENTS'] ?? '4999');
  if (!Number.isInteger(amountCents) || amountCents < 100 || amountCents > 1_000_000) {
    throw new Error('STRIPE_AMOUNT_INVALID');
  }

  const mode = process.env['STRIPE_CHECKOUT_MODE'] === 'payment' ? 'payment' : 'subscription';
  return {
    mode,
    amountCents,
    lineItems: [{
      price_data: {
        currency: 'usd',
        product_data: { name: 'Plan de mantenimiento técnico' },
        unit_amount: amountCents,
        ...(mode === 'subscription' ? { recurring: { interval: 'month' as const } } : {}),
      },
      quantity: 1,
    }],
  };
}

async function applyPaymentUpdate(input: {
  stripeCheckoutSessionId?: string | null;
  stripeSubscriptionId?: string | null;
  expectedUserId?: number;
  expectedAmountCents?: number | null;
  status: PaymentStatus;
  nextSubscriptionId?: string | null;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const payment = input.stripeCheckoutSessionId
      ? await tx.orm.public.Payment.where({ stripeCheckoutSessionId: input.stripeCheckoutSessionId }).first()
      : input.stripeSubscriptionId
        ? await tx.orm.public.Payment.where({ stripeSubscriptionId: input.stripeSubscriptionId }).first()
        : null;

    if (!payment) {
      if (input.status === 'PAID' && input.stripeCheckoutSessionId) {
        throw new Error('PAYMENT_NOT_FOUND');
      }
      return;
    }

    if (input.expectedUserId !== undefined && payment.userId !== input.expectedUserId) {
      throw new Error('PAYMENT_USER_MISMATCH');
    }

    if (
      input.expectedAmountCents != null
      && Number.isFinite(input.expectedAmountCents)
      && decimalToCents(payment.amount) !== input.expectedAmountCents
    ) {
      throw new Error('PAYMENT_AMOUNT_MISMATCH');
    }

    if (!canTransition(payment.status, input.status)) {
      return;
    }

    await tx.orm.public.Payment.where({ id: payment.id }).update({
      status: input.status,
      ...(input.nextSubscriptionId ? { stripeSubscriptionId: input.nextSubscriptionId } : {}),
    });
  });
}

export async function createCheckoutSession(userId: number) {
  const client = requireStripe();
  const appUrl = process.env['CLIENT_APP_URL'] ?? 'http://localhost:5173';
  const plan = await resolveCheckoutPlan(client);

  const session = await client.checkout.sessions.create({
    mode: plan.mode,
    line_items: plan.lineItems,
    client_reference_id: String(userId),
    metadata: { userId: String(userId) },
    success_url: `${appUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/?payment=canceled`,
  });

  if (!session.id) {
    throw new Error('STRIPE_SESSION_MISSING');
  }

  try {
    await db.transaction(async (tx) => {
      await tx.orm.public.Payment.create({
        userId,
        stripeCheckoutSessionId: session.id,
        amount: centsToDecimal(plan.amountCents),
        status: 'PENDING',
      });
    });
  } catch (error) {
    await client.checkout.sessions.expire(session.id).catch(() => undefined);
    throw error;
  }

  return session;
}

export async function handleWebhookEvent(payload: Buffer, signature: string) {
  const client = requireStripe();
  const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];
  if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_NOT_CONFIGURED');

  const event = client.webhooks.constructEvent(payload, signature, webhookSecret);

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object;
    const expectedUserId = Number(session.metadata?.userId ?? session.client_reference_id);
    if (!session.id || !Number.isInteger(expectedUserId) || expectedUserId <= 0) {
      throw new Error('INVALID_STRIPE_SESSION');
    }

    await applyPaymentUpdate({
      stripeCheckoutSessionId: session.id,
      expectedUserId,
      expectedAmountCents: session.amount_total,
      status: 'PAID',
      nextSubscriptionId: readStripeId(session.subscription),
    });
    return;
  }

  if (event.type === 'checkout.session.async_payment_failed') {
    const session = event.data.object;
    if (!session.id) return;
    await applyPaymentUpdate({
      stripeCheckoutSessionId: session.id,
      status: 'FAILED',
    });
    return;
  }

  if (event.type === 'checkout.session.expired') {
    const session = event.data.object;
    if (!session.id) return;
    await applyPaymentUpdate({
      stripeCheckoutSessionId: session.id,
      status: 'CANCELED',
    });
    return;
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object;
    const subscriptionId = readStripeId((invoice as { subscription?: unknown }).subscription);
    if (!subscriptionId) return;
    await applyPaymentUpdate({
      stripeSubscriptionId: subscriptionId,
      status: 'FAILED',
    });
  }
}

export const handleStripeWebhook = handleWebhookEvent;
