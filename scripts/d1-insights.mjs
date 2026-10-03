// Thin wrapper over the one remote D1 command the operator allowed (CLAUDE.md): read-only query
// insights for the staging database. Never pass --remote/execute flags here and never target
// work-os-production; this script only ever reads staging query statistics.
import { spawnSync } from 'node:child_process';

const DATABASE = 'work-os-2-staging-db';
const timePeriod = process.argv.includes('--time-period') ? process.argv[process.argv.indexOf('--time-period') + 1] : '1d';
const limit = process.argv.includes('--limit') ? process.argv[process.argv.indexOf('--limit') + 1] : '30';

const result = spawnSync('npx', ['wrangler', 'd1', 'insights', DATABASE, '--sort-by', 'reads', '--time-period', timePeriod, '--limit', limit, '--json'], {
  encoding: 'utf8',
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || `wrangler exited with ${result.status}\n`);
  process.exit(result.status || 1);
}

let rows;
try {
  rows = JSON.parse(result.stdout);
} catch {
  process.stdout.write(result.stdout);
  throw new Error('Could not parse wrangler --json output as JSON.');
}

const totalRead = rows.reduce((sum, row) => sum + (Number(row.totalRowsRead) || 0), 0);
const totalCalls = rows.reduce((sum, row) => sum + (Number(row.numberOfTimesRun) || 0), 0);

console.log(`D1 insights — ${DATABASE}, last ${timePeriod}, top ${rows.length} by rows read\n`);
for (const row of rows) {
  const firstLine = String(row.query || '').trim().split('\n')[0].slice(0, 100);
  console.log(`${String(row.totalRowsRead).padStart(8)} rows  (${String(row.numberOfTimesRun).padStart(5)} calls, avg ${Math.round(row.avgRowsRead)})  ${firstLine}`);
}
console.log(`\nTotal in this top-${rows.length}: ${totalRead} rows read over ${totalCalls} calls.`);
console.log('This is only the reported top slice, not the database-wide daily total.');
