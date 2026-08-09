import { setManagedAgentAutoRestart } from "@/shared/api/tauriManagedAgents";
import type { ManagedAgent, UpdateManagedAgentInput } from "@/shared/api/types";

type UpdateManagedAgentResult = {
  agent: ManagedAgent;
  profileSyncError: string | null;
};

/**
 * Saves the authoritative record before its independent restart preference.
 * A primary mutation failure remains React Query-owned; a secondary failure is
 * surfaced after the committed agent result is retained.
 */
export async function saveAgentInstance({
  agent,
  autoRestartOnConfigChange,
  input,
  onAutoRestartPreferenceError,
  update,
}: {
  agent: ManagedAgent;
  autoRestartOnConfigChange: boolean;
  input: UpdateManagedAgentInput;
  onAutoRestartPreferenceError: () => void;
  update: (input: UpdateManagedAgentInput) => Promise<UpdateManagedAgentResult>;
}): Promise<
  { result: UpdateManagedAgentResult; savedAgent: ManagedAgent } | undefined
> {
  let result: UpdateManagedAgentResult;
  try {
    result = await update(input);
  } catch {
    return undefined;
  }

  let savedAgent = result.agent;
  if (autoRestartOnConfigChange !== agent.autoRestartOnConfigChange) {
    try {
      savedAgent = await setManagedAgentAutoRestart(
        agent.pubkey,
        autoRestartOnConfigChange,
      );
    } catch {
      onAutoRestartPreferenceError();
    }
  }

  return { result, savedAgent };
}
