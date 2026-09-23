import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

void test('WhatsApp and Viber chat links stay in the browser instead of invoking desktop protocol handlers', async () => {
  const workspace = await readFile(new URL('../components/platform-workspace.tsx', import.meta.url), 'utf8');

  assert.match(workspace, /if\(platform==='whatsapp'\|\|platform==='viber'\)/);
  assert.match(workspace, /host==='chat\.whatsapp\.com'/);
  assert.match(workspace, /'invite\.viber\.com','chats\.viber\.com'/);
  assert.match(workspace, /window\.open\(url\.toString\(\),'_blank','noopener,noreferrer'\)/);
  assert.match(workspace, /return;/);

  const browserBranch = workspace.slice(
    workspace.indexOf("if(platform==='whatsapp'||platform==='viber')"),
    workspace.indexOf("const nativeLink=nativeChatLink", workspace.indexOf("if(platform==='whatsapp'||platform==='viber')")),
  );
  assert.doesNotMatch(browserBranch, /whatsapp:\/\//);
  assert.doesNotMatch(browserBranch, /viber:\/\//);
  assert.doesNotMatch(workspace, /viber:\/\/community_invite/);
});
