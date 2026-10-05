import { Router } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.middleware.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { createCheckoutSession, handleWebhookEvent } from './payment.service.js';

export const paymentRouter = Router();

paymentRouter.post('/checkout', requireAuth, async (request: AuthenticatedRequest, response) => {
  const userId = request.userId;
  if (!userId) {
    response.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const session = await createCheckoutSession(userId);
    response.status(200).json({ checkoutUrl: session.url });
  } catch (error) {
    if (error instanceof Error && error.message === 'STRIPE_NOT_CONFIGURED') {
      response.status(503).json({ error: 'Stripe is not configured' });
      return;
    }
    if (error instanceof Error && (error.message === 'STRIPE_PRICE_INVALID' || error.message === 'STRIPE_AMOUNT_INVALID')) {
      response.status(503).json({ error: 'Stripe plan is not configured' });
      return;
    }
    response.status(500).json({ error: 'Unable to create checkout session' });
  }
});

paymentRouter.post('/webhook', async (request, response) => {
  const signature = request.headers['stripe-signature'];
  if (typeof signature !== 'string' || !Buffer.isBuffer(request.body)) {
    response.status(400).json({ error: 'Stripe signature and raw body are required' });
    return;
  }

  try {
    await handleWebhookEvent(request.body, signature);
    response.status(200).json({ received: true });
  } catch (error) {
    if (error instanceof Error && (error.message === 'STRIPE_NOT_CONFIGURED' || error.message === 'STRIPE_WEBHOOK_NOT_CONFIGURED')) {
      response.status(503).json({ error: 'Stripe webhook is not configured' });
      return;
    }
    if (error instanceof Error && error.message === 'PAYMENT_NOT_FOUND') {
      response.status(500).json({ error: 'Payment record not found for Stripe session' });
      return;
    }
    response.status(400).json({ error: 'Invalid Stripe webhook' });
  }
});
