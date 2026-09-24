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

export async function verifyQuotaSafeCodeOnlyDeploy({
  currentSha,
  stagingBuildUrl,
  compareCommits,
  fetcher = fetch,
}) {
  if (!/^[0-9a-f]{40}$/i.test(String(currentSha || ''))) {
    return { allowed:false,reason:'current_build_sha_unknown',deployedBuildId:null,migrationFiles:[] };
  }

  let buildResponse;
  try {
    buildResponse = await fetcher(stagingBuildUrl, {
      headers:{Accept:'application/json','Cache-Control':'no-cache'},
      cache:'no-store',
    });
  } catch {
    return { allowed:false,reason:'staging_build_identity_unreachable',deployedBuildId:null,migrationFiles:[] };
  }
  if (!buildResponse?.ok) {
    return { allowed:false,reason:'staging_build_identity_unreachable',deployedBuildId:null,migrationFiles:[] };
  }

  let build;
  try { build = await buildResponse.json(); }
  catch {
    return { allowed:false,reason:'staging_build_identity_invalid',deployedBuildId:null,migrationFiles:[] };
  }
  const deployedBuildId = typeof build?.buildId === 'string' ? build.buildId.trim() : '';
  if (!/^[0-9a-f]{40}$/i.test(deployedBuildId)) {
    return { allowed:false,reason:'staging_build_identity_invalid',deployedBuildId:deployedBuildId||null,migrationFiles:[] };
  }
  if (deployedBuildId === currentSha) {
    return { allowed:true,reason:'already_deployed',deployedBuildId,migrationFiles:[] };
  }
  if (typeof compareCommits !== 'function') {
    return { allowed:false,reason:'local_comparator_missing',deployedBuildId,migrationFiles:[] };
  }

  let comparison;
  try { comparison = await compareCommits({deployedBuildId,currentSha}); }
  catch {
    return { allowed:false,reason:'local_commit_comparison_failed',deployedBuildId,migrationFiles:[] };
  }
  if (!comparison || comparison.ok !== true) {
    return {
      allowed:false,
      reason:comparison?.reason || 'local_commit_comparison_failed',
      deployedBuildId,
      migrationFiles:comparison?.migrationFiles || [],
    };
  }
  const migrationFiles = migrationFilesFromComparison(comparison.files);
  if (migrationFiles.length > 0) {
    return { allowed:false,reason:'migration_delta_present',deployedBuildId,migrationFiles };
  }
  return { allowed:true,reason:'code_only_since_deployed_staging',deployedBuildId,migrationFiles:[] };
}) {
  if (!/^[0-9a-f]{40}$/i.test(String(currentSha || ''))) {
    return { allowed: false, reason: 'current_build_sha_unknown', deployedBuildId: null, migrationFiles: [] };
  }

  let buildResponse;
  try {
    buildResponse = await fetcher(stagingBuildUrl, {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      cache: 'no-store',
    });
  } catch {
    return { allowed: false, reason: 'staging_build_identity_unreachable', deployedBuildId: null, migrationFiles: [] };
  }
  if (!buildResponse?.ok) {
    return { allowed: false, reason: 'staging_build_identity_unreachable', deployedBuildId: null, migrationFiles: [] };
  }

  let build;
  try {
    build = await buildResponse.json();
  } catch {
    return { allowed: false, reason: 'staging_build_identity_invalid', deployedBuildId: null, migrationFiles: [] };
  }
  const deployedBuildId = typeof build?.buildId === 'string' ? build.buildId.trim() : '';
  if (!/^[0-9a-f]{40}$/i.test(deployedBuildId)) {
    return { allowed: false, reason: 'staging_build_identity_invalid', deployedBuildId: deployedBuildId || null, migrationFiles: [] };
  }
  if (deployedBuildId === currentSha) {
    return { allowed: true, reason: 'already_deployed', deployedBuildId, migrationFiles: [] };
  }

  const compareUrl = `https://api.github.com/repos/${repository}/compare/${deployedBuildId}...${currentSha}`;
  let compareResponse;
  try {
    compareResponse = await fetcher(compareUrl, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'work-os-staging-deploy' },
      cache: 'no-store',
    });
  } catch {
    return { allowed: false, reason: 'commit_comparison_unreachable', deployedBuildId, migrationFiles: [] };
  }
  if (!compareResponse?.ok) {
    return { allowed: false, reason: 'commit_comparison_unreachable', deployedBuildId, migrationFiles: [] };
  }

  let comparison;
  try {
    comparison = await compareResponse.json();
  } catch {
    return { allowed: false, reason: 'commit_comparison_invalid', deployedBuildId, migrationFiles: [] };
  }
  if (!['ahead', 'identical'].includes(comparison?.status)) {
    return { allowed: false, reason: 'staging_not_ancestor_of_build', deployedBuildId, migrationFiles: [] };
  }

  const migrationFiles = migrationFilesFromComparison(comparison.files);
  if (migrationFiles.length > 0) {
    return { allowed: false, reason: 'migration_delta_present', deployedBuildId, migrationFiles };
  }
  return { allowed: true, reason: 'code_only_since_deployed_staging', deployedBuildId, migrationFiles: [] };
}
