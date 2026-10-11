'use client';

import { ReportsWorkspace } from '@/components/reports-workspace';
import { useShell } from '@/components/shell/shell-context';
import { useViewActive } from '@/components/shell/view-pane';

// ТИМЧАСОВО: прототип 2 у світлому контейнері, поки розділ не переписано на 3.0.
export default function ReportsView() {
  const { syncRevision, openLead } = useShell();
  const active = useViewActive();
  return <div className="legacy-surface"><ReportsWorkspace syncRevision={syncRevision} active={active} onOpenLead={openLead} /></div>;
}
