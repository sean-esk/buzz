import type { UpdateManagedAgentResponse } from "@/shared/api/tauri";
import type { ManagedAgent, UpdateManagedAgentInput } from "@/shared/api/types";

type SetManagedAgentAutoRestartInput = {
  pubkey: string;
  autoRestartOnConfigChange: boolean;
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
  setAutoRestart,
  update,
}: {
  agent: ManagedAgent;
  autoRestartOnConfigChange: boolean;
  input: UpdateManagedAgentInput;
  onAutoRestartPreferenceError: (error: unknown) => void;
  setAutoRestart: (
    input: SetManagedAgentAutoRestartInput,
  ) => Promise<ManagedAgent>;
  update: (
    input: UpdateManagedAgentInput,
  ) => Promise<UpdateManagedAgentResponse>;
}): Promise<
  { result: UpdateManagedAgentResponse; savedAgent: ManagedAgent } | undefined
> {
  let result: UpdateManagedAgentResponse;
  try {
    result = await update(input);
  } catch {
    return undefined;
  }

  let savedAgent = result.agent;
  if (autoRestartOnConfigChange !== agent.autoRestartOnConfigChange) {
    try {
      savedAgent = await setAutoRestart({
        pubkey: agent.pubkey,
        autoRestartOnConfigChange,
      });
    } catch (error: unknown) {
      onAutoRestartPreferenceError(error);
    }
  }

  return { result, savedAgent };
}
