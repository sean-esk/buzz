use tauri::State;

use crate::{
    app_state::AppState, managed_agents::RelayAgentInfo, nostr_convert, relay::query_relay,
};

#[tauri::command]
pub async fn list_relay_agents(state: State<'_, AppState>) -> Result<Vec<RelayAgentInfo>, String> {
    let agent_events = query_relay(&state, &[serde_json::json!({ "kinds": [30177] })])
        .await
        .map_err(|error| format!("managed-agent directory query failed: {error}"))?;
    let candidate_pubkeys = nostr_convert::agent_directory::candidate_pubkeys(&agent_events);
    if candidate_pubkeys.is_empty() {
        return Ok(Vec::new());
    }
    let profile_events = query_relay(
        &state,
        &[serde_json::json!({ "kinds": [0], "authors": candidate_pubkeys })],
    )
    .await
    .map_err(|error| format!("managed-agent owner verification query failed: {error}"))?;
    let membership_events = query_relay(
        &state,
        &[serde_json::json!({ "kinds": [39002], "#p": candidate_pubkeys })],
    )
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
        query_relay(
            &state,
            &[serde_json::json!({ "kinds": [39000], "#d": channel_ids })],
        )
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
