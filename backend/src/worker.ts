/**
 * worker.ts - SkeletonVid Pro
 * Cloudflare Worker entrypoint with CORS, trial checkout, and licensing endpoints.
 */

import { Env, CheckoutRequest, LicenseRefreshRequest, PortalRequest } from "./types.js";
import { signEd25519License } from "./license.js";
import { createCheckoutSession, createPortalSession } from "./stripe.js";
import { handleStripeWebhook } from "./webhook.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Stripe-Signature, Authorization"
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      // 1. Health check
      if (url.pathname === "/api/health" && req.method === "GET") {
        return Response.json({ status: "healthy", timestamp: Date.now() }, { headers: CORS_HEADERS });
      }

      // 2. Stripe Checkout Session (3-Day Free Trial)
      if (url.pathname === "/api/checkout" && req.method === "POST") {
        const body = (await req.json()) as CheckoutRequest;
        if (!body.email) {
          return Response.json({ error: "Email is required" }, { status: 400, headers: CORS_HEADERS });
        }
        const sessionUrl = await createCheckoutSession(env, body.email);
        return Response.json({ url: sessionUrl }, { headers: CORS_HEADERS });
      }

      // 3. Stripe Webhook
      if (url.pathname === "/api/webhook" && req.method === "POST") {
        return handleStripeWebhook(req, env);
      }

      // 4. Ed25519 License Token Issuance & Refresh
      if (url.pathname === "/api/license/refresh" && req.method === "POST") {
        const { customerId } = (await req.json()) as LicenseRefreshRequest;
        if (!customerId) {
          return Response.json({ error: "customerId is required" }, { status: 400, headers: CORS_HEADERS });
        }

        const user = await env.DB.prepare(
          "SELECT subscription_status, current_period_end FROM users WHERE stripe_customer_id = ?"
        ).bind(customerId).first<{ subscription_status: string; current_period_end: number }>();

        if (!user || !["trialing", "active"].includes(user.subscription_status)) {
          return Response.json(
            { error: "No active subscription or 3-day trial found" },
            { status: 403, headers: CORS_HEADERS }
          );
        }

        const token = await signEd25519License(
          customerId,
          Number(user.current_period_end),
          env.ED25519_PRIVATE_KEY_JWK
        );

        return Response.json(
          {
            licenseToken: token,
            status: user.subscription_status,
            expiresAt: user.current_period_end
          },
          { headers: CORS_HEADERS }
        );
      }

      // 5. Stripe Billing Portal (Manage / Cancel subscription in 2 clicks)
      if (url.pathname === "/api/portal" && req.method === "POST") {
        const { customerId } = (await req.json()) as PortalRequest;
        if (!customerId) {
          return Response.json({ error: "customerId is required" }, { status: 400, headers: CORS_HEADERS });
        }
        const portalUrl = await createPortalSession(env, customerId);
        return Response.json({ url: portalUrl }, { headers: CORS_HEADERS });
      }

      return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Internal Server Error";
      console.error("[SkeletonVid:Worker] Unhandled error:", message);
      return Response.json({ error: message }, { status: 500, headers: CORS_HEADERS });
    }
  }
};
