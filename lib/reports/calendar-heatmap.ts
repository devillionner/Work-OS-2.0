export function reportRevisionHeatClass(revisionCount: number): string {
  if (!Number.isFinite(revisionCount) || revisionCount <= 0) return '';
  const count = Math.floor(revisionCount);
  if (count >= 4) return 'revision-4';
  if (count === 3) return 'revision-3';
  if (count === 2) return 'revision-2';
  return 'revision-1';
}
