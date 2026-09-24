export function normalizeMeetingLink(value: string): string {
  const input = value.trim();
  if (!input) return '';

  const extracted = input.match(/https?:\/\/[^\s<>"']+/i)?.[0] ?? input;

  try {
    const url = new URL(extracted);
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'zoom.us' || hostname.endsWith('.zoom.us')) {
      const password = url.searchParams.get('pwd');
      if (password) {
        const cleanPassword = password.split(/\s+/)[0]?.trim() ?? '';
        if (cleanPassword && cleanPassword !== password) {
          url.searchParams.set('pwd', cleanPassword);
          return url.toString();
        }
      }
    }
    return extracted;
  } catch {
    return extracted;
  }
}
