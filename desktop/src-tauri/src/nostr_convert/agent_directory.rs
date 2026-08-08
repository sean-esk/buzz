//! Verified public managed-agent directory projection.
//!
//! A kind:30177 is owner-authored state, while the agent identity is its sole
//! `d` tag. This module keeps present-but-invalid claims visible as non-
//! invocable entries so they cannot accidentally fall through to membership
//! discovery.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use nostr::{Event, PublicKey};
use serde::Deserialize;

use crate::{
    managed_agents::{
        validate_respond_to_allowlist, DirectoryRespondTo, DirectoryState, RelayAgentInfo,
    },
    nostr_convert::profile_valid_oa_owner_pubkey,
};

#[derive(Debug, Deserialize)]
struct DirectoryContent {
    name: Option<String>,
    #[serde(default)]
    respond_to: Option<String>,
    #[serde(default)]
    respond_to_allowlist: Vec<String>,
}

#[derive(Debug)]
struct Candidate<'a> {
    event: &'a Event,
    agent_pubkey: String,
}

fn exactly_one_tag_value(event: &Event, name: &str) -> Option<String> {
    let values: Vec<&str> = event
        .tags
        .iter()
        .filter_map(|tag| {
            let tag = tag.as_slice();
            (tag.first().map(String::as_str) == Some(name) && tag.len() >= 2)
                .then(|| tag[1].as_str())
        })
        .collect();
    match values.as_slice() {
        [value] if !value.trim().is_empty() => Some((*value).to_string()),
        _ => None,
    }
}

fn newest_by_key<'a>(events: impl IntoIterator<Item = &'a Event>) -> Vec<&'a Event> {
    let mut heads: BTreeMap<String, &'a Event> = BTreeMap::new();
    for event in events {
        let key = event.pubkey.to_hex();
        let take = heads.get(&key).is_none_or(|current| {
            (event.created_at, event.id.to_hex()) > (current.created_at, current.id.to_hex())
        });
        if take {
            heads.insert(key, event);
        }
    }
    heads.into_values().collect()
}

fn current_candidates(events: &[Event]) -> Vec<Candidate<'_>> {
    let mut by_agent: BTreeMap<String, Candidate<'_>> = BTreeMap::new();
    for event in events {
        let Some(d_tag) = exactly_one_tag_value(event, "d") else {
            continue;
        };
        let Ok(agent_pubkey) = PublicKey::from_hex(&d_tag) else {
            continue;
        };
        let agent_pubkey = agent_pubkey.to_hex();
        let candidate = Candidate {
            event,
            agent_pubkey: agent_pubkey.clone(),
        };
        let take = by_agent.get(&agent_pubkey).is_none_or(|current| {
            (candidate.event.created_at, candidate.event.id.to_hex())
                > (current.event.created_at, current.event.id.to_hex())
        });
        if take {
            by_agent.insert(agent_pubkey, candidate);
        }
    }
    by_agent.into_values().collect()
}

fn content_state(
    content: &DirectoryContent,
) -> (
    Option<String>,
    Option<DirectoryRespondTo>,
    Vec<String>,
    DirectoryState,
) {
    let name = content
        .name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string);
    let policy = match content.respond_to.as_deref() {
        Some("owner-only") => Some(DirectoryRespondTo::OwnerOnly),
        Some("allowlist") => Some(DirectoryRespondTo::Allowlist),
        Some("anyone") => Some(DirectoryRespondTo::Anyone),
        Some("nobody") => Some(DirectoryRespondTo::Nobody),
        _ => None,
    };
    let allowlist = validate_respond_to_allowlist(&content.respond_to_allowlist).ok();
    let complete = name.is_some()
        && policy.is_some()
        && allowlist.is_some()
        && !(matches!(policy, Some(DirectoryRespondTo::Allowlist))
            && allowlist.as_ref().is_some_and(Vec::is_empty));
    (
        name,
        policy,
        allowlist.unwrap_or_default(),
        if complete {
            DirectoryState::Resolved
        } else {
            DirectoryState::Incomplete
        },
    )
}

/// Project signed public config, agent profiles, memberships, and optional
/// channel metadata into deterministic relay-directory rows.
pub(crate) fn project_relay_agents(
    agent_events: &[Event],
    profile_events: &[Event],
    membership_events: &[Event],
    metadata_events: &[Event],
) -> Vec<RelayAgentInfo> {
    let profiles: HashMap<String, &Event> = newest_by_key(profile_events)
        .into_iter()
        .map(|event| (event.pubkey.to_hex(), event))
        .collect();
    let candidates = current_candidates(agent_events);
    let candidate_pubkeys: BTreeSet<String> = candidates
        .iter()
        .map(|candidate| candidate.agent_pubkey.clone())
        .collect();
    let mut channels_by_agent: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for event in membership_events {
        let Some(channel_id) = exactly_one_tag_value(event, "d") else {
            continue;
        };
        for tag in event.tags.iter() {
            let tag = tag.as_slice();
            if tag.len() > 3 && tag[0] == "p" && tag[3] == "bot" {
                if let Ok(pubkey) = PublicKey::from_hex(&tag[1]) {
                    let pubkey = pubkey.to_hex();
                    if candidate_pubkeys.contains(&pubkey) {
                        channels_by_agent
                            .entry(pubkey)
                            .or_default()
                            .insert(channel_id.clone());
                    }
                }
            }
        }
    }
    let channel_names: BTreeMap<String, String> = metadata_events
        .iter()
        .filter_map(|event| {
            let id = exactly_one_tag_value(event, "d")?;
            let name = event
                .tags
                .iter()
                .find_map(|tag| {
                    let tag = tag.as_slice();
                    (tag.first().map(String::as_str) == Some("name") && tag.len() >= 2)
                        .then(|| tag[1].trim())
                        .filter(|name| !name.is_empty())
                        .map(str::to_string)
                })
                .unwrap_or_else(|| id.clone());
            Some((id, name))
        })
        .collect();

    candidates
        .into_iter()
        .map(|candidate| {
            let owner_pubkey = candidate.event.pubkey.to_hex();
            let parsed = serde_json::from_str::<DirectoryContent>(&candidate.event.content).ok();
            let (name, respond_to, respond_to_allowlist, mut directory_state) = parsed
                .as_ref()
                .map(content_state)
                .unwrap_or((None, None, Vec::new(), DirectoryState::Incomplete));
            let profile_owner = profiles
                .get(&candidate.agent_pubkey)
                .and_then(|profile| profile_valid_oa_owner_pubkey(profile));
            if profile_owner.as_deref() != Some(owner_pubkey.as_str()) {
                directory_state = DirectoryState::Untrusted;
            }
            let channel_ids: Vec<String> = channels_by_agent
                .remove(&candidate.agent_pubkey)
                .unwrap_or_default()
                .into_iter()
                .collect();
            let channels = channel_ids
                .iter()
                .map(|id| channel_names.get(id).cloned().unwrap_or_else(|| id.clone()))
                .collect();
            RelayAgentInfo {
                pubkey: candidate.agent_pubkey,
                name: name.unwrap_or_else(|| "Unknown agent".to_string()),
                agent_type: "agent".to_string(),
                channels,
                channel_ids,
                capabilities: Vec::new(),
                status: "offline".to_string(),
                respond_to,
                respond_to_allowlist,
                owner_pubkey: Some(owner_pubkey),
                directory_state,
            }
        })
        .collect()
}

/// Return valid, unique agent pubkeys from identifiable 30177 events for the
/// command's bounded kind:0 and 39002 queries.
pub(crate) fn candidate_pubkeys(events: &[Event]) -> Vec<String> {
    current_candidates(events)
        .into_iter()
        .map(|candidate| candidate.agent_pubkey)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Tag};

    fn event(keys: &Keys, kind: u16, content: &str, tags: Vec<Vec<String>>) -> Event {
        let tags: Vec<Tag> = tags
            .into_iter()
            .filter_map(|tag| Tag::parse(tag).ok())
            .collect();
        EventBuilder::new(Kind::from_u16(kind), content)
            .tags(tags)
            .sign_with_keys(keys)
            .expect("test event signs")
    }

    fn config(owner: &Keys, agent: &Keys, policy: &str, tags: Vec<Vec<String>>) -> Event {
        event(
            owner,
            30177,
            &serde_json::json!({"name":"Neo", "parallelism": 1, "respond_to": policy}).to_string(),
            tags.into_iter()
                .chain(std::iter::once(vec![
                    "d".to_string(),
                    agent.public_key().to_hex(),
                ]))
                .collect(),
        )
    }

    fn verified_profile(owner: &Keys, agent: &Keys) -> Event {
        let agent_pubkey =
            PublicKey::from_hex(&agent.public_key().to_hex()).expect("test pubkey parses");
        let auth = buzz_sdk_pkg::nip_oa::compute_auth_tag(owner, &agent_pubkey, "")
            .expect("test auth tag");
        let auth: Vec<String> = serde_json::from_str(&auth).expect("test auth JSON");
        event(agent, 0, "{}", vec![auth])
    }

    #[test]
    fn resolves_verified_config_and_exact_bot_membership() {
        let owner = Keys::generate();
        let agent = Keys::generate();
        let config = config(&owner, &agent, "anyone", Vec::new());
        let profile = verified_profile(&owner, &agent);
        let membership = event(
            &owner,
            39002,
            "",
            vec![
                vec!["d".into(), "general".into()],
                vec![
                    "p".into(),
                    agent.public_key().to_hex(),
                    "".into(),
                    "bot".into(),
                ],
            ],
        );
        let agents = project_relay_agents(&[config], &[profile], &[membership], &[]);
        assert_eq!(agents.len(), 1);
        assert_eq!(
            agents[0].owner_pubkey.as_deref(),
            Some(owner.public_key().to_hex().as_str())
        );
        assert_eq!(agents[0].directory_state, DirectoryState::Resolved);
        assert_eq!(agents[0].channel_ids, vec!["general"]);
    }

    #[test]
    fn untrusted_and_incomplete_entries_remain_present() {
        let owner = Keys::generate();
        let agent = Keys::generate();
        let config = config(&owner, &agent, "mystery", Vec::new());
        let agents = project_relay_agents(&[config], &[], &[], &[]);
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].directory_state, DirectoryState::Untrusted);
        assert_eq!(agents[0].respond_to, None);
    }

    #[test]
    fn only_bot_role_and_single_valid_d_tag_are_accepted() {
        let owner = Keys::generate();
        let agent = Keys::generate();
        let profile = verified_profile(&owner, &agent);
        let config = config(&owner, &agent, "anyone", Vec::new());
        let member = event(
            &owner,
            39002,
            "",
            vec![
                vec!["d".into(), "general".into()],
                vec![
                    "p".into(),
                    agent.public_key().to_hex(),
                    "".into(),
                    "member".into(),
                ],
            ],
        );
        let agents = project_relay_agents(&[config], &[profile], &[member], &[]);
        assert!(agents[0].channel_ids.is_empty());
        let ambiguous = event(
            &owner,
            30177,
            "{}",
            vec![
                vec!["d".into(), agent.public_key().to_hex()],
                vec!["d".into(), agent.public_key().to_hex()],
            ],
        );
        assert!(candidate_pubkeys(&[ambiguous]).is_empty());
    }
}
