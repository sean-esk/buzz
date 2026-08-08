import type { Channel, RelayAgent } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

export function getSharedChannelIds(channels: readonly Channel[] | undefined) {
  return new Set(
    (channels ?? [])
      .filter((channel) => channel.isMember && channel.archivedAt === null)
      .map((channel) => channel.id),
  );
}

export function relayAgentDirectoryByPubkey(
  relayAgents: readonly RelayAgent[] | undefined,
) {
  return new Map(
    (relayAgents ?? []).map((agent) => [
      normalizePubkey(agent.pubkey),
      { name: agent.name, ownerPubkey: agent.ownerPubkey },
    ]),
  );
}

export function relayAgentIsSharedWithUser(
  agent: Pick<
    RelayAgent,
    | "channelIds"
    | "ownerPubkey"
    | "respondTo"
    | "respondToAllowlist"
    | "directoryState"
  >,
  sharedChannelIds: ReadonlySet<string>,
  currentPubkey?: string | null,
) {
  const normalizedCurrentPubkey = currentPubkey
    ? normalizePubkey(currentPubkey)
    : null;

  if (
    agent.directoryState !== undefined &&
    agent.directoryState !== "resolved"
  ) {
    return false;
  }
  if (agent.respondTo === "anyone") {
    return (
      agent.channelIds.some((channelId) => sharedChannelIds.has(channelId)) &&
      relayAgentPolicyAllows(agent, normalizedCurrentPubkey)
    );
  }
  return relayAgentPolicyAllows(agent, normalizedCurrentPubkey);
}

export function relayAgentCanRespondInChannel(
  agent: Pick<
    RelayAgent,
    | "channelIds"
    | "ownerPubkey"
    | "respondTo"
    | "respondToAllowlist"
    | "directoryState"
  >,
  channelId: string,
  currentPubkey?: string | null,
) {
  return (
    (agent.directoryState === undefined ||
      agent.directoryState === "resolved") &&
    agent.channelIds.includes(channelId) &&
    relayAgentPolicyAllows(
      agent,
      currentPubkey ? normalizePubkey(currentPubkey) : null,
    )
  );
}

function relayAgentPolicyAllows(
  agent: Pick<RelayAgent, "ownerPubkey" | "respondTo" | "respondToAllowlist">,
  normalizedCurrentPubkey: string | null,
) {
  if (!agent.respondTo) return false;
  if (agent.respondTo === "anyone") return true;
  if (agent.respondTo === "nobody" || !normalizedCurrentPubkey) return false;
  const isOwner =
    typeof agent.ownerPubkey === "string" &&
    normalizePubkey(agent.ownerPubkey) === normalizedCurrentPubkey;
  switch (agent.respondTo) {
    case "allowlist":
      return (
        isOwner ||
        agent.respondToAllowlist.some(
          (pubkey) => normalizePubkey(pubkey) === normalizedCurrentPubkey,
        )
      );
    case "owner-only":
      return isOwner;
  }
}

export type AgentEligibilityScope =
  | { type: "community" }
  | { type: "channel"; channelId: string }
  | { type: "direct-message" }
  | { type: "managed-only" };

export function getMentionableAgentPubkeys({
  currentPubkey,
  eligibilityScope,
  managedAgentPubkeys,
  relayAgents,
  relayDirectorySettled = false,
  sharedChannelIds,
}: {
  currentPubkey?: string | null;
  eligibilityScope: AgentEligibilityScope;
  managedAgentPubkeys: Iterable<string>;
  relayAgents: readonly RelayAgent[] | undefined;
  /** Successful directory response; loading and errors must fail closed. */
  relayDirectorySettled: boolean;
  sharedChannelIds: ReadonlySet<string>;
}) {
  const pubkeys = new Set(
    [...managedAgentPubkeys].map((pubkey) => normalizePubkey(pubkey)),
  );

  for (const agent of relayAgents ?? []) {
    const isAllowed =
      !relayDirectorySettled ||
      eligibilityScope.type === "managed-only" ||
      eligibilityScope.type === "direct-message"
        ? false
        : eligibilityScope.type === "community"
          ? relayAgentIsSharedWithUser(agent, sharedChannelIds, currentPubkey)
          : relayAgentCanRespondInChannel(
              agent,
              eligibilityScope.channelId,
              currentPubkey,
            );
    if (isAllowed) {
      pubkeys.add(normalizePubkey(agent.pubkey));
    }
  }

  return pubkeys;
}

export function isAgentIdentityInAllowedList(
  candidate: { isAgent?: boolean; pubkey: string },
  allowedAgentPubkeys: ReadonlySet<string>,
) {
  return (
    candidate.isAgent !== true ||
    allowedAgentPubkeys.has(normalizePubkey(candidate.pubkey))
  );
}

export function shouldHideAgentFromMentions({
  isAgent,
  isMember,
  pubkey,
  mentionableAgentPubkeys,
  directoryAgentPubkeys,
  relayDirectorySettled = false,
}: {
  isAgent: boolean;
  isMember: boolean;
  pubkey: string;
  mentionableAgentPubkeys: ReadonlySet<string>;
  directoryAgentPubkeys: ReadonlySet<string>;
  relayDirectorySettled: boolean;
}) {
  if (!isAgent) return false;
  const normalized = normalizePubkey(pubkey);
  // Invocable => always show.
  if (mentionableAgentPubkeys.has(normalized)) return false;
  // Non-member, non-invocable => hide (preserves prior behavior).
  if (!isMember) return true;
  // Membership fallback is only safe after a successful directory settle.
  // A present directory entry that did not make the allowed set is an
  // explicit denial, incomplete record, or failed owner verification.
  return !relayDirectorySettled || directoryAgentPubkeys.has(normalized);
}

export function isAgentMentionChannelType(type?: string | null) {
  return type === "stream" || type === "forum";
}

export function uniqueAutocompleteLabels(
  candidates: readonly AgentAutocompleteCandidate[],
) {
  const unique = new Map<string, string>();
  for (const candidate of candidates) {
    for (const label of [
      candidate.displayName,
      candidate.personaName,
      candidate.secondaryLabel,
    ]) {
      const trimmed = label?.trim();
      if (trimmed && !unique.has(trimmed.toLowerCase())) {
        unique.set(trimmed.toLowerCase(), trimmed);
      }
    }
  }
  return [...unique.values()];
}

export function filterCachedAgentSuggestions<
  T extends {
    isAgent?: boolean;
    pubkey?: string;
  },
>(
  suggestions: readonly T[],
  currentCandidates: readonly AgentAutocompleteCandidate[],
) {
  const admittedAgentPubkeys = new Set(
    currentCandidates.flatMap((candidate) =>
      candidate.isAgent && candidate.pubkey
        ? [normalizePubkey(candidate.pubkey)]
        : [],
    ),
  );
  return suggestions.filter(
    (suggestion) =>
      !suggestion.isAgent ||
      !suggestion.pubkey ||
      admittedAgentPubkeys.has(normalizePubkey(suggestion.pubkey)),
  );
}

type AgentAutocompleteCandidate = {
  pubkey?: string;
  displayName?: string | null;
  personaName?: string | null;
  secondaryLabel?: string | null;
  ownerPubkey?: string | null;
  isAgent?: boolean;
  isManagedAgent?: boolean;
  isMember?: boolean;
  personaId?: string | null;
};

function agentIdentityKey<T extends AgentAutocompleteCandidate>(candidate: T) {
  if (candidate.isAgent !== true || !candidate.pubkey) {
    return null;
  }

  // Pubkeys—not persona metadata or a display name—are agent identities.
  // A persona may be installed more than once, and an owner may intentionally
  // create multiple same-named agents. Collapsing either case makes one agent
  // impossible to choose from autocomplete.
  return `pubkey:${normalizePubkey(candidate.pubkey)}`;
}

function agentCandidateRank<T extends AgentAutocompleteCandidate>(
  candidate: T,
  preferredPubkeys: ReadonlySet<string>,
) {
  const pubkey = candidate.pubkey ? normalizePubkey(candidate.pubkey) : null;

  return [
    candidate.isMember === true ? 0 : 1,
    pubkey && preferredPubkeys.has(pubkey) ? 0 : 1,
    candidate.isManagedAgent === true ? 0 : 1,
    candidate.personaId ? 0 : 1,
  ];
}

function isPreferredAgentCandidate<T extends AgentAutocompleteCandidate>(
  next: T,
  current: T,
  preferredPubkeys: ReadonlySet<string>,
) {
  const nextRank = agentCandidateRank(next, preferredPubkeys);
  const currentRank = agentCandidateRank(current, preferredPubkeys);

  for (let index = 0; index < nextRank.length; index++) {
    if (nextRank[index] !== currentRank[index]) {
      return nextRank[index] < currentRank[index];
    }
  }

  return false;
}

export function coalesceAutocompleteCandidatesByKey<T>(
  candidates: readonly T[],
  getKey: (candidate: T) => string | null,
) {
  const output: T[] = [];
  const indexesByKey = new Map<string, number>();

  for (const candidate of candidates) {
    const key = getKey(candidate);
    if (!key) {
      output.push(candidate);
      continue;
    }

    if (!indexesByKey.has(key)) {
      indexesByKey.set(key, output.length);
      output.push(candidate);
    }
  }

  return output;
}

export function coalesceAgentAutocompleteCandidates<
  T extends AgentAutocompleteCandidate,
>(
  candidates: readonly T[],
  {
    currentPubkey: _currentPubkey,
    getLabel: _getLabel,
    preferredPubkeys = new Set(),
  }: {
    currentPubkey?: string | null;
    getLabel: (candidate: T) => string | null | undefined;
    preferredPubkeys?: ReadonlySet<string>;
  },
) {
  const output: T[] = [];
  const indexesByKey = new Map<string, number>();

  for (const candidate of candidates) {
    const key = agentIdentityKey(candidate);
    if (!key) {
      output.push(candidate);
      continue;
    }

    const currentIndex = indexesByKey.get(key);
    if (currentIndex === undefined) {
      indexesByKey.set(key, output.length);
      output.push(candidate);
      continue;
    }

    if (
      isPreferredAgentCandidate(
        candidate,
        output[currentIndex],
        preferredPubkeys,
      )
    ) {
      output[currentIndex] = candidate;
    }
  }

  return output;
}
