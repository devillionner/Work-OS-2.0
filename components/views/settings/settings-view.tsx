'use client';

import { SettingsWorkspace } from '@/components/settings-workspace';
import { useShell } from '@/components/shell/shell-context';
import { useViewActive } from '@/components/shell/view-pane';

// ТИМЧАСОВО: прототип 2 у світлому контейнері, поки розділ не переписано на 3.0.
export default function SettingsView() {
  const { user, snapshot, refreshSnapshot } = useShell();
  const active = useViewActive();
  return <div className="legacy-surface"><SettingsWorkspace user={user} snapshot={snapshot} active={active} onRefresh={refreshSnapshot} /></div>;
}
