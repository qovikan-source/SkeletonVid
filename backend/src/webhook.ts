/**
 * webhook.ts - SkeletonVid Pro
 * Handles Stripe webhook events and synchronizes D1 database state.
 */

import { Env } from "./types.js";
import { getStripe } from "./stripe.js";
import Stripe from "stripe";

export async function handleStripeWebhook(req: Request, env: Env): Promise<Response> {
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  const rawBody = await req.text();
  const stripe = getStripe(env);

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      sig,
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[SkeletonVid:Webhook] Signature verification failed:", message);
    return new Response(`Webhook Error: ${message}`, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId = session.customer as string;
      const subId = session.subscription as string;
      const email = session.customer_details?.email || session.customer_email || "";
      const trialPeriodEnd = now + 3 * 86400; // 3-day trial period

      await env.DB.prepare(`
        INSERT INTO users (id, email, stripe_customer_id, stripe_subscription_id, subscription_status, current_period_end, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'trialing', ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET
          stripe_customer_id = excluded.stripe_customer_id,
          stripe_subscription_id = excluded.stripe_subscription_id,
          subscription_status = 'trialing',
          current_period_end = excluded.current_period_end,
          updated_at = excluded.updated_at
      `).bind(crypto.randomUUID(), email, customerId, subId, trialPeriodEnd, now, now).run();

      console.log(`[SkeletonVid:Webhook] Registered new 3-day trial for ${email} (Customer: ${customerId})`);
      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = sub.customer as string;
      const status = sub.status; // 'trialing', 'active', 'past_due', 'canceled'
      const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end || now;

      await env.DB.prepare(`
        UPDATE users SET
          subscription_status = ?,
          current_period_end = ?,
          updated_at = ?
        WHERE stripe_customer_id = ?
      `).bind(status, periodEnd, now, customerId).run();

      console.log(`[SkeletonVid:Webhook] Subscription updated for customer ${customerId}: ${status}`);
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = sub.customer as string;

      await env.DB.prepare(`
        UPDATE users SET
          subscription_status = 'canceled',
          updated_at = ?
        WHERE stripe_customer_id = ?
      `).bind(now, customerId).run();

      console.log(`[SkeletonVid:Webhook] Subscription canceled for customer ${customerId}`);
      break;
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;

      await env.DB.prepare(`
        UPDATE users SET
          subscription_status = 'active',
          updated_at = ?
        WHERE stripe_customer_id = ?
      `).bind(now, customerId).run();

      console.log(`[SkeletonVid:Webhook] Invoice paid for customer ${customerId}`);
      break;
    }
  }

  return Response.json({ received: true });
}
