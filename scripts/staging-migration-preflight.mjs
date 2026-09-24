const MIGRATION_NAME = /\b\d{4}_[A-Za-z0-9._-]+\.sql\b/g;

export function parseStagingMigrationList(output) {
  const text = String(output || '');

  if (/No migrations to apply!/i.test(text)) {
    return { pending: false, names: [] };
  }

  const names = [...new Set(text.match(MIGRATION_NAME) || [])];
  if (names.length > 0) {
    return { pending: true, names };
  }

  throw new Error('Could not determine staging migration state from Wrangler output.');
}

export function isD1DailyRowReadLimit(output) {
  return /exceeded D1(?:'s)? free tier daily row read limit/i.test(String(output || ''));
}

export function migrationFilesFromComparison(files) {
  return (Array.isArray(files) ? files : [])
    .map((item) => typeof item === 'string' ? item : item?.filename)
    .filter((name) => typeof name === 'string' && /^migrations\/.*\.sql$/i.test(name));
}

export async function verifyQuotaSafeMigrationFingerprint({
  currentFingerprint,
  stagingBuildUrl,
  knownBaselines = {},
  fetcher = fetch,
}) {
  if (!/^[0-9a-f]{64}$/i.test(String(currentFingerprint || ''))) {
    return { allowed:false,reason:'current_migration_fingerprint_invalid',deployedBuildId:null,deployedFingerprint:null };
  }

  let response;
  try {
    response = await fetcher(stagingBuildUrl, {
      headers:{Accept:'application/json','Cache-Control':'no-cache'},
      cache:'no-store',
    });
  } catch {
    return { allowed:false,reason:'staging_build_identity_unreachable',deployedBuildId:null,deployedFingerprint:null };
  }
  if (!response?.ok) {
    return { allowed:false,reason:'staging_build_identity_unreachable',deployedBuildId:null,deployedFingerprint:null };
  }

  let build;
  try { build = await response.json(); }
  catch {
    return { allowed:false,reason:'staging_build_identity_invalid',deployedBuildId:null,deployedFingerprint:null };
  }

  const deployedBuildId = typeof build?.buildId === 'string' ? build.buildId.trim() : '';
  if (!/^[0-9a-f]{40}$/i.test(deployedBuildId)) {
    return { allowed:false,reason:'staging_build_identity_invalid',deployedBuildId:deployedBuildId||null,deployedFingerprint:null };
  }

  const advertised = typeof build?.migrationFingerprint === 'string' ? build.migrationFingerprint.trim() : '';
  const baseline = typeof knownBaselines?.[deployedBuildId] === 'string' ? knownBaselines[deployedBuildId] : '';
  const deployedFingerprint = /^[0-9a-f]{64}$/i.test(advertised) ? advertised : baseline;

  if (!/^[0-9a-f]{64}$/i.test(deployedFingerprint)) {
    return { allowed:false,reason:'staging_migration_fingerprint_unknown',deployedBuildId,deployedFingerprint:null };
  }
  if (deployedFingerprint !== currentFingerprint) {
    return { allowed:false,reason:'migration_fingerprint_mismatch',deployedBuildId,deployedFingerprint };
  }

  return { allowed:true,reason:'migration_fingerprint_match',deployedBuildId,deployedFingerprint };
}
