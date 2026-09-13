export type LeadScriptItem = {
  id: string;
  title: string;
  ukText: string;
  ruText: string;
  notes: string;
  tags: string[];
  platforms: string[];
  updatedAt: number;
};

export type LeadScriptContext = {
  platform: string;
  subject: string;
  funnelStage: string;
  qualification: string | null;
};

export type RankedLeadScript = LeadScriptItem & {
  score: number;
  audience: 'personal' | 'work';
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('uk-UA');
}

function tokens(value: string): string[] {
  return normalize(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1);
}

function containsAny(haystack: Set<string>, needles: string[]): boolean {
  return needles.some((needle) => haystack.has(needle));
}

export function rankLeadScripts(
  items: LeadScriptItem[],
  context: LeadScriptContext,
  limit = 6,
): RankedLeadScript[] {
  const platform = normalize(context.platform);
  const subjectTokens = tokens(context.subject);
  const stageTokens = tokens(context.funnelStage);
  const qualification = normalize(context.qualification ?? '');

  return items
    .map((item): RankedLeadScript | null => {
      const itemPlatforms = item.platforms.map(normalize).filter(Boolean);
      if (itemPlatforms.length && !itemPlatforms.includes(platform)) return null;

      const searchable = new Set([
        ...tokens(item.title),
        ...tokens(item.notes),
        ...item.tags.flatMap(tokens),
      ]);
      let score = 1;
      if (itemPlatforms.includes(platform)) score += 6;
      if (subjectTokens.length && containsAny(searchable, subjectTokens)) score += 10;
      if (stageTokens.length && containsAny(searchable, stageTokens)) score += 4;
      if (qualification && searchable.has(qualification)) score += 3;

      const personalTags = new Set(['personal', 'особистий', 'особисте', 'особисті']);
      const audience = item.tags.some((tag) => personalTags.has(normalize(tag)))
        ? 'personal'
        : 'work';
      return { ...item, score, audience };
    })
    .filter((item): item is RankedLeadScript => item !== null)
    .sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt || a.title.localeCompare(b.title, 'uk'))
    .slice(0, Math.max(0, limit));
}
