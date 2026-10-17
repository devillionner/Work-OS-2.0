declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    /** Файли «Розробки» (R2); лише в staging: у production прив'язки немає. */
    FILES?: R2Bucket;
    ASSETS: Fetcher;
    GOOGLE_CLIENT_ID: string;
    OWNER_EMAIL: string;
    ALLOWED_GOOGLE_EMAILS?: string;
    AUDIT_ACCESS_TOKEN?: string;
    OWNER_CHANNEL: DurableObjectNamespace;
  }
}
