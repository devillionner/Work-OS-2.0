declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ASSETS: Fetcher;
    GOOGLE_CLIENT_ID: string;
    OWNER_EMAIL: string;
    ALLOWED_GOOGLE_EMAILS?: string;
    AUDIT_ACCESS_TOKEN?: string;
  }
}
