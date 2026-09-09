import { readdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? null;
}

function hasFlag(name) {
  return args.includes(name);
}

const database = option("--database");
const config = option("--config") ?? "wrangler.jsonc";
const env = option("--env");
const migrationsDir = resolve(option("--migrations-dir") ?? "migrations");
const remote = hasFlag("--remote");
const local = hasFlag("--local");
const allowProduction = hasFlag("--allow-production");

if (!database || remote === local) {
  console.error(
    "Usage: node scripts/apply-d1-migrations.mjs --database <name-or-binding> --remote|--local [--config <path>] [--migrations-dir <path>] [--allow-production]",
  );
  process.exit(2);
}

const configPath = resolve(config);
let configText = "";
try {
  configText = await readFile(configPath, "utf8");
} catch {
  console.error(`Could not read Wrangler config: ${configPath}`);
  process.exit(2);
}
const isProductionTarget =
  /work-os-production|work-os-2"/.test(configText) ||
  env === "production";
if (remote && isProductionTarget && !allowProduction) {
  console.error(
    "Refusing a production migration without --allow-production. Review the backup and cutover plan first.",
  );
  process.exit(3);
}

const wranglerCli = resolve("node_modules/wrangler/bin/wrangler.js");

function run(commandArgs, label) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [wranglerCli, ...commandArgs], {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else rejectPromise(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

const scopeFlags = [
  remote ? "--remote" : "--local",
  "--config",
  configPath,
  ...(env ? ["--env", env] : []),
];

async function execute(command, label) {
  return run(["d1", "execute", database, ...scopeFlags, ...command], label);
}

function parseJsonOutput(stdout) {
  const start = stdout.indexOf("[");
  if (start === -1) return null;
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    return null;
  }
}

await execute(
  ["--command", "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);"],
  "ensure d1_migrations table",
);

const appliedResult = await execute(
  ["--json", "--command", "SELECT name FROM d1_migrations ORDER BY id;"],
  "read applied migrations",
);
const appliedJson = parseJsonOutput(appliedResult.stdout);
const applied = new Set(
  (appliedJson?.[0]?.results ?? []).map((row) => row.name),
);

const files = (await readdir(migrationsDir))
  .filter((file) => /^\d+_.+\.sql$/i.test(file))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

for (const file of files) {
  if (applied.has(file)) {
    console.log(`Skipping applied migration ${file}`);
    continue;
  }

  const path = resolve(migrationsDir, file);
  console.log(`Applying ${file} through D1 file import`);
  await execute(["--file", path], `apply ${file}`);

  const escapedName = file.replaceAll("'", "''");
  await execute(
    [
      "--command",
      `INSERT INTO d1_migrations (name) VALUES ('${escapedName}');`,
    ],
    `record ${file}`,
  );
  applied.add(file);
}

console.log(`D1 migrations complete: ${files.length} migration file(s) checked.`);
