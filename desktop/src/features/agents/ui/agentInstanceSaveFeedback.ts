import { toast } from "sonner";

export function reportAutoRestartPreferenceError(
  agentPubkey: string,
  error: unknown,
) {
  console.error(
    `Could not save auto-restart preference for ${agentPubkey}`,
    error,
  );
  toast.error(
    "Agent saved, but the automatic restart preference was not updated. Reopen this agent and try again.",
  );
}

export function reportAgentInstanceSaveFlowError(
  agentPubkey: string,
  error: unknown,
) {
  console.error(
    `Could not finish managed agent save flow for ${agentPubkey}`,
    error,
  );
  toast.error(
    "Buzz could not finish the save flow. Reopen the agent to verify its saved state, then try again.",
  );
}
