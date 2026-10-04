// Durable Object storage for the Discovery autonomous run (lib/chat-discovery/run-state.ts). The run's
// candidates are stored one key each and only the ones that changed are written, so a run with hundreds of
// checked chats never hits the per-value size limit and a single result writes one small entry.
import { EMPTY_RUN, type DiscoveryRunState, type RunCandidate, type SourceFeedback } from './run-state.ts';

type RunStorage = {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(keys: string[]): Promise<number>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
};

const META_KEY = 'drun:meta';
const CANDIDATE_PREFIX = 'drun:c:';
const FEEDBACK_KEY = 'drun:feedback';
const GROUPS_KEY = 'drun:groups';
// Storage batches are bounded (128 keys per put/delete call).
const BATCH = 100;

export type TelegramGroupSource = { name: string; link: string };

export async function loadRun(storage: RunStorage): Promise<DiscoveryRunState> {
  const meta = await storage.get<Omit<DiscoveryRunState, 'candidates'>>(META_KEY);
  if (!meta) return EMPTY_RUN;
  const stored = await storage.list<RunCandidate>({ prefix: CANDIDATE_PREFIX });
  const candidates = [...stored.values()].sort((a, b) => (a.discoveredAt - b.discoveredAt) || a.id.localeCompare(b.id));
  return { ...EMPTY_RUN, ...meta, candidates };
}

/** Writes the meta and only the candidates that changed (new object) or disappeared since `previous`. */
export async function saveRun(storage: RunStorage, previous: DiscoveryRunState, next: DiscoveryRunState): Promise<void> {
  const before = new Map(previous.candidates.map((candidate) => [candidate.id, candidate]));
  const changed: Record<string, unknown> = {};
  for (const candidate of next.candidates) {
    if (before.get(candidate.id) !== candidate) changed[CANDIDATE_PREFIX + candidate.id] = candidate;
    before.delete(candidate.id);
  }
  const entries = Object.entries(changed);
  for (let index = 0; index < entries.length; index += BATCH) await storage.put(Object.fromEntries(entries.slice(index, index + BATCH)));
  const removed = [...before.keys()].map((id) => CANDIDATE_PREFIX + id);
  for (let index = 0; index < removed.length; index += BATCH) await storage.delete(removed.slice(index, index + BATCH));
  const { candidates: _candidates, ...meta } = next;
  await storage.put(META_KEY, meta);
}

export async function loadSourceFeedback(storage: RunStorage): Promise<SourceFeedback> {
  return (await storage.get<SourceFeedback>(FEEDBACK_KEY)) ?? {};
}

export async function saveSourceFeedback(storage: RunStorage, feedback: SourceFeedback): Promise<void> {
  await storage.put(FEEDBACK_KEY, feedback);
}

export async function loadTelegramGroups(storage: RunStorage): Promise<TelegramGroupSource[]> {
  return (await storage.get<TelegramGroupSource[]>(GROUPS_KEY)) ?? [];
}

export async function saveTelegramGroups(storage: RunStorage, groups: TelegramGroupSource[]): Promise<void> {
  await storage.put(GROUPS_KEY, groups.slice(0, 3000));
}
