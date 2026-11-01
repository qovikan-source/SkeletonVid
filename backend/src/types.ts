export interface Env {
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_ID: string;
  ED25519_PRIVATE_KEY_JWK: string;
  APP_URL?: string;
  DB: D1Database;
}

export interface UserRecord {
  id: string;
  email: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string;
  current_period_end: number | null;
  created_at: number;
  updated_at: number;
}

export interface CheckoutRequest {
  email: string;
}

export interface LicenseRefreshRequest {
  customerId?: string;
  sessionId?: string;
}

export interface PortalRequest {
  customerId: string;
}
