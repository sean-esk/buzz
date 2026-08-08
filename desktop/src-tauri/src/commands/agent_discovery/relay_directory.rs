use std::future::Future;

use nostr::Event;
use serde_json::Value;
use tauri::State;

use crate::{
    app_state::AppState, managed_agents::RelayAgentInfo, nostr_convert, relay::query_relay,
};

#[tauri::command]
pub async fn list_relay_agents(state: State<'_, AppState>) -> Result<Vec<RelayAgentInfo>, String> {
    let app_state = state.inner();
    discover_relay_agents(|filters| async move { query_relay(app_state, &filters).await }).await
}

async fn discover_relay_agents<Query, QueryFuture>(
    mut query: Query,
) -> Result<Vec<RelayAgentInfo>, String>
where
    Query: FnMut(Vec<Value>) -> QueryFuture,
    QueryFuture: Future<Output = Result<Vec<Event>, String>>,
{
    let agent_events = query(vec![serde_json::json!({ "kinds": [30177] })])
        .await
        .map_err(|error| format!("managed-agent directory query failed: {error}"))?;
    let candidate_pubkeys = nostr_convert::agent_directory::candidate_pubkeys(&agent_events);
    if candidate_pubkeys.is_empty() {
        return Ok(Vec::new());
    }
    let profile_events = query(vec![
        serde_json::json!({ "kinds": [0], "authors": candidate_pubkeys }),
    ])
    .await
    .map_err(|error| format!("managed-agent owner verification query failed: {error}"))?;
    let membership_events = query(vec![
        serde_json::json!({ "kinds": [39002], "#p": candidate_pubkeys }),
    ])
    .await
    .map_err(|error| format!("managed-agent membership query failed: {error}"))?;
    let preliminary = nostr_convert::agent_directory::project_relay_agents(
        &agent_events,
        &profile_events,
        &membership_events,
        &[],
    );
    let channel_ids: Vec<String> = preliminary
        .iter()
        .flat_map(|agent| agent.channel_ids.iter().cloned())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    let metadata_events = if channel_ids.is_empty() {
        Vec::new()
    } else {
        query(vec![
            serde_json::json!({ "kinds": [39000], "#d": channel_ids }),
        ])
        .await
        .unwrap_or_default()
    };
    Ok(nostr_convert::agent_directory::project_relay_agents(
        &agent_events,
        &profile_events,
        &membership_events,
        &metadata_events,
    ))
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, future::ready};

    use nostr::{Event, EventBuilder, Keys, Kind, Tag};

    use super::*;

    fn event(keys: &Keys, kind: u16, content: &str, tags: Vec<Vec<String>>) -> Event {
        EventBuilder::new(Kind::from_u16(kind), content)
            .tags(
                tags.into_iter()
                    .map(Tag::parse)
                    .collect::<Result<Vec<_>, _>>()
                    .expect("test tags parse"),
            )
            .sign_with_keys(keys)
            .expect("test event signs")
    }

    #[tokio::test]
    async fn metadata_failure_preserves_agents_and_uses_bounded_filters() {
        let owner = Keys::generate();
        let agent = Keys::generate();
        let agent_pubkey = agent.public_key().to_hex();
        let directory = event(
            &owner,
            30177,
            &serde_json::json!({"name": "Neo", "respond_to": "anyone"}).to_string(),
            vec![vec!["d".to_string(), agent_pubkey.clone()]],
        );
        let membership = event(
            &owner,
            39002,
            "",
            vec![
                vec!["d".to_string(), "general".to_string()],
                vec![
                    "p".to_string(),
                    agent_pubkey.clone(),
                    "".to_string(),
                    "bot".to_string(),
                ],
            ],
        );
        let responses = RefCell::new(vec![
            Ok(vec![directory]),
            Ok(Vec::new()),
            Ok(vec![membership]),
            Err("metadata unavailable".to_string()),
        ]);
        let calls = RefCell::new(Vec::new());

        let agents = discover_relay_agents(|filters| {
            calls.borrow_mut().push(filters);
            ready(responses.borrow_mut().remove(0))
        })
        .await
        .expect("metadata errors are best effort");

        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].channel_ids, vec!["general"]);
        assert_eq!(
            calls.borrow().as_slice(),
            [
                vec![serde_json::json!({ "kinds": [30177] })],
                vec![serde_json::json!({ "kinds": [0], "authors": [agent_pubkey] })],
                vec![serde_json::json!({ "kinds": [39002], "#p": [agent_pubkey] })],
                vec![serde_json::json!({ "kinds": [39000], "#d": ["general"] })],
            ]
        );
    }

    #[tokio::test]
    async fn empty_directory_skips_follow_up_queries() {
        let calls = RefCell::new(Vec::new());
        let agents = discover_relay_agents(|filters| {
            calls.borrow_mut().push(filters);
            ready(Ok(Vec::new()))
        })
        .await
        .expect("empty directory is valid");

        assert!(agents.is_empty());
        assert_eq!(
            calls.borrow().as_slice(),
            [vec![serde_json::json!({ "kinds": [30177] })]]
        );
    }
}
