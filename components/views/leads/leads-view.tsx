'use client';

import { LeadsWorkspace } from '@/components/leads/workspace';
import { useShell } from '@/components/shell/shell-context';
import { useViewActive } from '@/components/shell/view-pane';
import { useQueryParam } from '@/components/shell/url-state';

// ТИМЧАСОВО: прототип 2 у світлому контейнері, поки розділ не переписано на 3.0.
export default function LeadsView() {
  const { user, syncRevision } = useShell();
  const active = useViewActive();
  const [leadId] = useQueryParam('lead');
  return (
    <div className="legacy-surface">
      <LeadsWorkspace account={user.email} initialLeadId={leadId} syncRevision={syncRevision} active={active} />
    </div>
  );
}
