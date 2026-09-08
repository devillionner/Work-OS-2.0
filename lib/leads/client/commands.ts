type LeadVersion = { id: string; version: number };
export type Pending = { key: string; body: string };
// An uncertain response must be resolved with the original command, even if the
// UI has refreshed or the user changed form fields. Never silently rebook.
export function createCommandClient(
  fetcher: typeof fetch,
  journal?: { read(): Pending | null; write(value: Pending | null): void },
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

export function createBrowserCommandClient(account: string) {
  return createCommandClient(
    (input, init) => fetch(input, init),
    sessionJournal(account),
  );
}
