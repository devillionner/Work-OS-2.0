'use client';

import { PlatformWorkspace } from '@/components/platform-workspace';
import { useShell } from '@/components/shell/shell-context';
import { useViewActive } from '@/components/shell/view-pane';

// ТИМЧАСОВО: прототип 2 у світлому контейнері, поки розділ не переписано на 3.0.
export default function PlatformsView() {
  const { snapshot, syncRevision } = useShell();
  const active = useViewActive();
  return (
    <div className="legacy-surface">
      <PlatformWorkspace enabledPlatforms={snapshot.enabledPlatforms} syncRevision={syncRevision} businessDate={snapshot.today} active={active} />
    </div>
  );
}
