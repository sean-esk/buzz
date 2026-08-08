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

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DirectoryState {
    #[default]
    Incomplete,
    Resolved,
    Untrusted,
}
