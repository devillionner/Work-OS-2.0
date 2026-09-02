declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ASSETS: Fetcher;
    GOOGLE_CLIENT_ID: string;
    OWNER_EMAIL: string;
  }
}
