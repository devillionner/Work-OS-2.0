import { announceDataChange } from '../../client-sync.ts';

type LeadVersion = { id: string; version: number };
export type Pending = { key: string; body: string };

export type CommandJournal = {
  read(): Pending | null;
  write(value: Pending | null): void;
};

const OUTBOX_DB = 'work-os-offline-outbox';
const OUTBOX_STORE = 'commands';
// An uncertain response must be resolved with the original command, even if the
// UI has refreshed or the user changed form fields. Never silently rebook.
export function createCommandClient(
  fetcher: typeof fetch,
  journal?: CommandJournal,
) {
  let pending: Pending | null = null;
  let initialized = false;
  let sending = false;
  return async (
    action: string,
    data: Record<string, unknown>,
    lead?: LeadVersion,
    entityId?: string,
  ): Promise<string> => {
    if (!initialized) {
      pending = journal?.read() ?? null;
      initialized = true;
    }
    if (sending) throw new Error('Попередня дія ще зберігається.');
    const payload = {
      action,
      data,
      leadId: lead?.id,
      version: lead?.version ?? 0,
      entityId,
    };
    const key = JSON.stringify(payload);
    const recovering = pending !== null && pending.key !== key;
    pending ??= {
      key,
      body: JSON.stringify({ commandId: crypto.randomUUID(), ...payload }),
    };
    journal?.write(pending);
    const body = pending.body;
    sending = true;
    try {
      const send = () =>
        fetcher('/api/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
      const response = await send().catch(() => send());
      const result = (await response.json()) as {
        id?: string;
        error?: string;
        details?: { duplicates?: Array<{ name: string }> };
      };
      if (response.ok && typeof result.id !== 'string')
        throw new Error('Не вдалося підтвердити збереження. Повторіть запит.');
      if (
        response.ok ||
        (response.status < 500 &&
          ![401, 403, 408, 429].includes(response.status))
      ) {
        pending = null;
        journal?.write(null);
      }
      if (!response.ok) {
        const names = result.details?.duplicates?.map((d) => d.name).join(', ');
        throw new Error(
          `${result.error || 'Не вдалося зберегти.'}${names ? ` Збіги: ${names}.` : ''}`,
        );
      }
      announceDataChange('leads');
      if (recovering)
        throw new Error(
          'Попереднє збереження підтверджено. Нову дію ще не виконано. Оновіть картку та перевірте дані перед повтором.',
        );
      return result.id!;
    } finally {
      sending = false;
    }
  };
}
// Temporary delivery intent only; authoritative state/receipts stay in D1.
// Namespace by authenticated account, never replay another account's form.
export function sessionJournal(owner: string) {
  const key = `work-os:pending-lead-command:${owner}`;
  return {
    read(): Pending | null {
      if (typeof window === 'undefined') return null;
      const raw = window.sessionStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Pending;
      if (typeof parsed.key !== 'string' || typeof parsed.body !== 'string')
        throw new Error(
          'Не вдалося прочитати незавершений запит. Перевірте останні зміни в CRM.',
        );
      return parsed;
    },
    write(value: Pending | null) {
      if (typeof window === 'undefined') return;
      if (value) window.sessionStorage.setItem(key, JSON.stringify(value));
      else window.sessionStorage.removeItem(key);
    },
  };
}

function outboxKey(owner: string) {
  return `lead-command:${owner}`;
}

export function indexedDbJournal(owner: string): CommandJournal {
  const fallback = sessionJournal(owner);
  let cached: Pending | null | undefined;
  let loading: Promise<Pending | null> | null = null;

  const load = () => {
    if (loading) return loading;
    loading = readOutbox(outboxKey(owner))
      .then((value) => {
        cached = value ?? fallback.read();
        return cached;
      })
      .catch(() => {
        cached = fallback.read();
        return cached;
      });
    return loading;
  };
  if (typeof window !== 'undefined') void load();

  return {
    read() {
      // Command submission is synchronous at this boundary. Until IndexedDB has
      // hydrated, sessionStorage is the safe immediate fallback; the durable
      // copy is mirrored below and survives a browser restart.
      return cached === undefined ? fallback.read() : cached;
    },
    write(value) {
      cached = value;
      fallback.write(value);
      if (typeof window === 'undefined') return;
      void writeOutbox(outboxKey(owner), value).catch(() => {
        // sessionStorage remains a conservative fallback if IndexedDB is
        // unavailable (private mode/storage denial).
      });
    },
  };
}

function openOutbox(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OUTBOX_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) db.createObjectStore(OUTBOX_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
  });
}

async function readOutbox(key: string): Promise<Pending | null> {
  if (typeof indexedDB === 'undefined') return null;
  const db = await openOutbox();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(OUTBOX_STORE, 'readonly').objectStore(OUTBOX_STORE).get(key);
      request.onsuccess = () => {
        const value = request.result;
        resolve(value && typeof value.key === 'string' && typeof value.body === 'string' ? value : null);
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function writeOutbox(key: string, value: Pending | null): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openOutbox();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(OUTBOX_STORE, 'readwrite');
      const store = tx.objectStore(OUTBOX_STORE);
      if (value) store.put(value, key);
      else store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function createBrowserCommandClient(account: string) {
  return createCommandClient(
    (input, init) => fetch(input, init),
    indexedDbJournal(account),
  );
}
