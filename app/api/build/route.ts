import { APP_BUILD_ID, APP_MIGRATION_FINGERPRINT } from '@/lib/build-id';
import { APP_VERSION } from '@/lib/app-meta';

export async function GET(): Promise<Response> {
  return Response.json(
    { buildId: APP_BUILD_ID, version: APP_VERSION, migrationFingerprint: APP_MIGRATION_FINGERPRINT },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        Pragma: 'no-cache',
      },
    },
  );
}
