/** Read-only public policy projected from a verified kind:30177 directory entry. */
export type RelayDirectoryRespondTo =
  | "owner-only"
  | "allowlist"
  | "anyone"
  | "nobody";

export type RelayAgentDirectoryState = "resolved" | "incomplete" | "untrusted";
