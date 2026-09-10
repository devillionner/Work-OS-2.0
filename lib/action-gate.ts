// Shared by controls that mutate the same workspace. Always release the gate,
// including after network errors; React state alone cannot stop same-tick clicks.
export function createActionGate() {
  let pending = false;
  return async (action: () => Promise<void>): Promise<boolean> => {
    if (pending) return false;
    pending = true;
    try { await action(); return true; }
    finally { pending = false; }
  };
}
