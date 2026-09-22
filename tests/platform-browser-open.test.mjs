import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

void test('WhatsApp chat links stay in the browser instead of invoking the desktop app', async () => {
  const workspace = await readFile(new URL('../components/platform-workspace.tsx', import.meta.url), 'utf8');

  assert.match(workspace, /if\(platform==='whatsapp'\)/);
  assert.match(workspace, /host==='chat\.whatsapp\.com'/);
  assert.match(workspace, /window\.open\(url\.toString\(\),'_blank','noopener,noreferrer'\)/);
  assert.match(workspace, /return;/);

  const whatsappBranch = workspace.slice(
    workspace.indexOf("if(platform==='whatsapp')"),
    workspace.indexOf("const nativeLink=nativeChatLink", workspace.indexOf("if(platform==='whatsapp')")),
  );
  assert.doesNotMatch(whatsappBranch, /whatsapp:\/\//);
});
