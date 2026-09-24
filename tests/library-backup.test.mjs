import assert from 'node:assert/strict';
import test from 'node:test';
import { BACKUP_TABLES } from '../lib/backups/export.ts';
import { CLOUD_BACKUP_SCHEMA_VERSION, inspectCloudBackup } from '../lib/backups/inspect.ts';

function payload(schemaVersion=CLOUD_BACKUP_SCHEMA_VERSION){
  const tables=Object.fromEntries(BACKUP_TABLES.map(table=>[table,[]]));
  const counts=Object.fromEntries(BACKUP_TABLES.map(table=>[table,0]));
  return {app:'work-os-cloud-backup',schemaVersion,createdAt:'2026-09-10T10:00:00.000Z',ownerEmail:'owner@example.com',ownerId:'owner',revision:1,counts,tables};
}

void test('backup schema 13 includes library history and CRM media tables',()=>{
  const backup=payload();
  backup.tables.library_items=[{id:'item',user_id:'owner',source_import_id:null}];
  backup.counts.library_items=1;
  backup.tables.library_item_versions=[{id:'version',user_id:'owner',item_id:'item'}];
  backup.counts.library_item_versions=1;
  const result=inspectCloudBackup(JSON.stringify(backup));
  assert.equal(CLOUD_BACKUP_SCHEMA_VERSION,13);
  assert.ok('lead_message_attachments' in backup.tables);
  assert.ok('lead_message_attachment_chunks' in backup.tables);
  assert.equal(result.valid,true,result.errors.join('\n'));
  assert.equal(result.counts.library_item_versions,1);
});

void test('schema 12 backup remains valid without CRM media tables',()=>{
  const backup=payload(12);
  delete backup.tables.lead_message_attachments;
  delete backup.counts.lead_message_attachments;
  delete backup.tables.lead_message_attachment_chunks;
  delete backup.counts.lead_message_attachment_chunks;
  const result=inspectCloudBackup(JSON.stringify(backup));
  assert.equal(result.valid,true,result.errors.join('\n'));
  assert.equal(result.counts.lead_message_attachments,0);
  assert.equal(result.counts.lead_message_attachment_chunks,0);
  assert.match(result.warnings.join('\n'),/попередню сумісну схему 12/);
});

void test('schema 10 backup remains valid without library history table',()=>{
  const backup=payload(10);
  delete backup.tables.library_item_versions;
  delete backup.counts.library_item_versions;
  const result=inspectCloudBackup(JSON.stringify(backup));
  assert.equal(result.valid,true,result.errors.join('\n'));
  assert.equal(result.counts.library_item_versions,0);
  assert.match(result.warnings.join('\n'),/попередню сумісну схему 10/);
});

void test('backup inspection rejects orphaned library snapshots',()=>{
  const backup=payload();
  backup.tables.library_item_versions=[{id:'version',user_id:'owner',item_id:'missing'}];
  backup.counts.library_item_versions=1;
  const result=inspectCloudBackup(JSON.stringify(backup));
  assert.equal(result.valid,false);
  assert.match(result.errors.join('\n'),/library_item_versions → library_items/);
});
