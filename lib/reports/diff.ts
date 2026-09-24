export type ReportTextDiffOperation = { kind: 'same' | 'added' | 'removed'; text: string };
export type ReportTextDiff = {
  operations: ReportTextDiffOperation[];
  added: number;
  removed: number;
  truncated: boolean;
  maxLines: number;
};

const MAX_CHARS = 20_000;
const MAX_LINES = 200;

export function diffReportText(previous: string, current: string): ReportTextDiff {
  const left = boundedLines(previous);
  const right = boundedLines(current);
  const rows = left.lines.length + 1;
  const cols = right.lines.length + 1;
  const table = Array.from({ length: rows }, () => new Uint16Array(cols));

  for (let i = left.lines.length - 1; i >= 0; i--) {
    for (let j = right.lines.length - 1; j >= 0; j--) {
      table[i][j] = left.lines[i] === right.lines[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const operations: ReportTextDiffOperation[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < left.lines.length || j < right.lines.length) {
    if (i < left.lines.length && j < right.lines.length && left.lines[i] === right.lines[j]) {
      operations.push({ kind: 'same', text: left.lines[i] });
      i++; j++;
    } else if (j < right.lines.length && (i === left.lines.length || table[i][j + 1] >= table[i + 1][j])) {
      operations.push({ kind: 'added', text: right.lines[j] });
      added++; j++;
    } else {
      operations.push({ kind: 'removed', text: left.lines[i] });
      removed++; i++;
    }
  }

  return { operations, added, removed, truncated: left.truncated || right.truncated, maxLines: MAX_LINES };
}

function boundedLines(value: string): { lines: string[]; truncated: boolean } {
  const charsTruncated = value.length > MAX_CHARS;
  const sliced = value.slice(0, MAX_CHARS);
  const all = sliced.split(/\r?\n/);
  const linesTruncated = all.length > MAX_LINES;
  return { lines: all.slice(0, MAX_LINES), truncated: charsTruncated || linesTruncated };
}
