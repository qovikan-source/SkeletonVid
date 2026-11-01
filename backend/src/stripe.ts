/**
 * stripe.ts - SkeletonVid Pro
 * Stripe Billing, Checkout Session, and Customer Portal integration.
 */

import Stripe from "stripe";
import { Env } from "./types.js";

export function getStripe(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: "2024-12-18.acacia" as unknown as Stripe.LatestApiVersion,
    httpClient: Stripe.createFetchHttpClient()
  });
}

export async function createCheckoutSession(env: Env, email: string): Promise<string> {
  const stripe = getStripe(env);
  const appUrl = env.APP_URL || "https://SkeletonVid.pro";

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: email,
    payment_method_collection: "always",
    line_items: [
      {
        price: env.STRIPE_PRICE_ID,
        quantity: 1
      }
    ],
    subscription_data: {
      trial_period_days: 3,
      trial_settings: {
        end_behavior: { missing_payment_method: "cancel" }
      }
    },
    success_url: `${appUrl}/welcome?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/pricing`
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout session URL");
  }

  return session.url;
}

export async function createPortalSession(env: Env, customerId: string): Promise<string> {
  const stripe = getStripe(env);
  const appUrl = env.APP_URL || "https://SkeletonVid.pro";

  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/pricing`
  });

  return portal.url;
}
