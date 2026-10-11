'use client';

import { LibraryWorkspace } from '@/components/library-workspace';
import { useShell } from '@/components/shell/shell-context';
import { useViewActive } from '@/components/shell/view-pane';

// ТИМЧАСОВО: прототип 2 у світлому контейнері, поки розділ не переписано на 3.0.
export default function LibraryView() {
  const { syncRevision } = useShell();
  const active = useViewActive();
  return <div className="legacy-surface"><LibraryWorkspace syncRevision={syncRevision} active={active} /></div>;
}
