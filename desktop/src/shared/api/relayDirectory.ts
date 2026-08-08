/** Read-only public policy projected from a verified kind:30177 directory entry. */
export type RelayDirectoryRespondTo =
  | "owner-only"
  | "allowlist"
  | "anyone"
  | "nobody";

/**
 * Trust state for a public directory row. Only `resolved` rows may be used to
 * invoke a remote agent; `incomplete` and `untrusted` remain visible so they
 * cannot be mistaken for settled absence.
 */
export type RelayAgentDirectoryState = "resolved" | "incomplete" | "untrusted";
