import type { Aggregate, Changes } from '../domain/types.ts';
export type ActionContext = {
  action: string;
  data: Record<string, unknown>;
  entityId: unknown;
  aggregate: Aggregate;
  changes: Changes;
  now: number;
  event: (
    type: string,
    eventDate?: string,
    lessonId?: string | null,
    metadata?: unknown,
  ) => void;
};
