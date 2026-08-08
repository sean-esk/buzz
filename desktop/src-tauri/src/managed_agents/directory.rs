use serde::{Deserialize, Serialize};

/// Read-only public-directory policy; the configuration UI intentionally does
/// not expose `Nobody`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DirectoryRespondTo {
    OwnerOnly,
    Allowlist,
    Anyone,
    Nobody,
}

/// Verification state for an identifiable public-directory claim.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DirectoryState {
    /// The claim is present, but required content or policy fields are invalid.
    #[default]
    Incomplete,
    /// Content is complete and the agent profile proves the directory author owns it.
    Resolved,
    /// The agent profile is missing valid NIP-OA proof for the directory author.
    Untrusted,
}
