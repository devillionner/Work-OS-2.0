import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

void test('WhatsApp links stay in browser while Viber uses the registered desktop protocol handler', async () => {
  const workspace = await readFile(new URL('../components/platform-workspace.tsx', import.meta.url), 'utf8');

  assert.match(workspace, /if\(platform==='whatsapp'\)/);
  assert.match(workspace, /host==='chat\.whatsapp\.com'/);
  assert.match(workspace, /window\.open\(url\.toString\(\),'_blank','noopener,noreferrer'\)/);

  const whatsappBranch = workspace.slice(
    workspace.indexOf("if(platform==='whatsapp')"),
    workspace.indexOf('const nativeLink=nativeChatLink', workspace.indexOf("if(platform==='whatsapp')")),
  );
  assert.doesNotMatch(whatsappBranch, /whatsapp:\/\//);

  assert.match(workspace, /platform==='viber'/);
  assert.match(workspace, /'invite\.viber\.com','chats\.viber\.com'/);
  assert.match(workspace, /viber:\/\/community_invite\?data=/);
});
