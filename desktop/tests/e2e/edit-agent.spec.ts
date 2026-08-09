import { expect, test } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const BAKED_DEFAULTS = [
  { key: "BUZZ_AGENT_PROVIDER", value: "anthropic", masked: false },
  {
    key: "BUZZ_AGENT_MODEL",
    value: "claude-opus-4-8",
    masked: false,
  },
  { key: "BUZZ_AGENT_THINKING_EFFORT", value: "high", masked: false },
  { key: "ANTHROPIC_API_KEY", value: "sk-ant-baked-test", masked: true },
];

// Edit-agent dialog coverage (Phase 1B.3b-pre). Written against TODAY'S
// EditAgentDialog, before the B3b re-host, so the re-host is guarded by a
// pre-existing spec rather than one written alongside it.
//
// Mock-boundary caveat: the e2eBridge `update_managed_agent` handler echoes
// name/model/systemPrompt/envVars/respondTo/respondToAllowlist into the
// mock store — it does NOT
// model the diff-based partial-update wire semantics (change-detected-or-omit,
// tri-state provider, harnessOverride derivation), and it ignores
// agentCommand/harnessOverride entirely. This spec therefore pins UI behavior
// (open → edit → save → persisted in UI), not wire semantics. The inherit
// toggle is not reachable here at all (see the routing pin below) — its
// behavior is covered by B3b's component-level pinning test (inherit-toggle
// → gate → submit); wire semantics stay component-test territory
// (personaRuntimeModel.test.mjs).

// Tyler's pubkey maps to gooseSurface in the mock bridge (runtimeId "goose"),
// which supports LLM provider selection — same seed the readiness-screenshot
// spec uses for its edit-dialog shot.
const AGENT_PUBKEY = TEST_IDENTITIES.tyler.pubkey;
const AGENT_NAME = "Tyler Agent";
const PERSONA_ID = "persona-edit-e2e";

/**
 * Open the Edit Agent dialog for the seeded managed agent via the profile
 * panel (agents view → agent card → Edit quick action) — EditAgentDialog's
 * only mount path.
 */
async function openEditDialog(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByTestId("open-agents-view").click();

  const agentButton = page.getByRole("button", {
    name: `${AGENT_NAME} agent profile`,
  });
  await expect(agentButton).toBeVisible({ timeout: 10_000 });
  await agentButton.click();

  await expect(page.getByTestId("user-profile-panel")).toBeVisible({
    timeout: 10_000,
  });
  await page.getByTestId("user-profile-edit-agent").click();

  await expect(page.getByTestId("edit-agent-dialog")).toBeVisible({
    timeout: 10_000,
  });
  // Provider field visible = runtime catalog loaded and form settled.
  await expect(page.locator("#edit-agent-llm-provider")).toBeVisible({
    timeout: 10_000,
  });
}

/**
 * Pick an option from a PersonaDropdownField (menu-based, not a native
 * <select> — Create's fields are selects, Edit's are not).
 */
async function pickDropdownOption(
  page: import("@playwright/test").Page,
  triggerId: string,
  optionName: string | RegExp,
) {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole("menuitemradio", { name: optionName }).click();
}

test.describe("agent definition dialog", () => {
  test("owner-only-access build shows disabled agent access with an explanation", async ({
    page,
  }) => {
    await installMockBridge(page, {
      ownerOnlyAccessBuild: true,
      bakedBuildEnv: BAKED_DEFAULTS,
    });
    await page.goto("/");
    await page.getByTestId("open-agents-view").click();
    await page.getByTestId("new-agent-card").click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Advanced", exact: true }).click();

    await expect(dialog.getByTestId("agent-respond-to")).toBeVisible();
    await expect(dialog.locator("#agent-respond-to")).toBeDisabled();
    await expect(dialog.locator("#agent-respond-to")).toContainText(
      "Only me (default)",
    );
    await expect(
      dialog.getByTestId("agent-respond-to-disabled-reason"),
    ).toHaveText("This build disallows changing this setting.");
  });
});

test.describe("edit agent dialog", () => {
  test("owner-only-access build shows a disabled owner-only access control with an explanation", async ({
    page,
  }) => {
    await installMockBridge(page, {
      ownerOnlyAccessBuild: true,
      bakedBuildEnv: BAKED_DEFAULTS,
      managedAgents: [
        {
          pubkey: AGENT_PUBKEY,
          name: AGENT_NAME,
          status: "stopped",
          channelNames: ["agents"],
          respondTo: "anyone",
        },
      ],
    });

    await openEditDialog(page);

    const accessControl = page.getByTestId("agent-respond-to");
    await expect(accessControl).toBeVisible();
    await expect(page.locator("#agent-respond-to")).toBeDisabled();
    await expect(page.locator("#agent-respond-to")).toContainText(
      "Only me (default)",
    );
    await expect(
      page.getByTestId("agent-respond-to-disabled-reason"),
    ).toHaveText("This build disallows changing this setting.");
  });

  test("OSS build keeps the managed-agent access control", async ({ page }) => {
    await installMockBridge(page, {
      bakedBuildEnv: BAKED_DEFAULTS,
      managedAgents: [
        {
          pubkey: AGENT_PUBKEY,
          name: AGENT_NAME,
          status: "stopped",
          channelNames: ["agents"],
        },
      ],
    });

    await openEditDialog(page);

    await expect(page.getByTestId("agent-respond-to")).toBeVisible();
  });

  test("edits the agent name and persists it across a dialog reopen", async ({
    page,
  }) => {
    await installMockBridge(page, {
      managedAgents: [
        {
          pubkey: AGENT_PUBKEY,
          name: AGENT_NAME,
          status: "stopped",
          channelNames: ["agents"],
        },
      ],
    });

    await openEditDialog(page);

    const nameInput = page.locator("#edit-agent-name");
    await expect(nameInput).toHaveValue(AGENT_NAME);
    await nameInput.fill("Tyler Agent Renamed");

    await page.getByTestId("edit-agent-dialog-submit").click();
    await expect(page.getByTestId("edit-agent-dialog")).not.toBeVisible();

    // Reopen: the dialog re-reads the managed-agents store, proving the save
    // survived the dialog lifecycle rather than living in local state. (The
    // panel HEADER is not asserted — it renders the relay profile name, which
    // the update path does not touch.)
    await page.getByTestId("user-profile-edit-agent").click();
    await expect(page.locator("#edit-agent-name")).toHaveValue(
      "Tyler Agent Renamed",
      { timeout: 10_000 },
    );
  });

  test("changes the model via custom entry and persists it", async ({
    page,
  }) => {
    await installMockBridge(page, {
      managedAgents: [
        {
          pubkey: AGENT_PUBKEY,
          name: AGENT_NAME,
          status: "stopped",
          channelNames: ["agents"],
        },
      ],
    });

    await openEditDialog(page);

    // Pick a provider so model discovery has a scope, then set a custom model.
    await pickDropdownOption(page, "edit-agent-llm-provider", "Anthropic");
    await pickDropdownOption(page, "edit-agent-model", "Custom model...");
    await page.locator("#edit-agent-custom-model").fill("claude-opus-4-5");
    // Anthropic requires a credential before save unlocks.
    await page.getByLabel("Anthropic API Key").fill("sk-test-edit-agent-e2e");

    const submit = page.getByTestId("edit-agent-dialog-submit");
    await expect(submit).toBeEnabled({ timeout: 10_000 });
    await submit.click();
    await expect(page.getByTestId("edit-agent-dialog")).not.toBeVisible();

    await page.getByTestId("user-profile-edit-agent").click();
    await expect(page.getByTestId("edit-agent-dialog")).toBeVisible({
      timeout: 10_000,
    });
    // Custom model round-trips: the reopened dialog shows it in the custom
    // input (the discovered-model lists don't contain it).
    await expect(page.locator("#edit-agent-custom-model")).toHaveValue(
      "claude-opus-4-5",
      { timeout: 10_000 },
    );
  });

  test("keeps the custom command visible without opening Advanced", async ({
    page,
  }) => {
    await installMockBridge(page, {
      managedAgents: [
        {
          pubkey: AGENT_PUBKEY,
          name: AGENT_NAME,
          status: "stopped",
          channelNames: ["agents"],
        },
      ],
    });

    await openEditDialog(page);

    const advanced = page.getByRole("button", {
      name: "Advanced",
      exact: true,
    });
    await expect(advanced).toHaveAttribute("aria-expanded", "false");
    await pickDropdownOption(page, "edit-agent-runtime", "Custom command");
    await expect(page.locator("#edit-agent-command")).toBeVisible();
    await expect(advanced).toHaveAttribute("aria-expanded", "false");
  });

  test("marks a missing advanced credential without opening Advanced", async ({
    page,
  }) => {
    await installMockBridge(page, {
      managedAgents: [
        {
          pubkey: AGENT_PUBKEY,
          name: AGENT_NAME,
          status: "stopped",
          channelNames: ["agents"],
        },
      ],
    });

    await openEditDialog(page);

    const advanced = page.getByRole("button", {
      name: "Advanced",
      exact: true,
    });
    await expect(advanced).toHaveAttribute("aria-expanded", "false");
    await pickDropdownOption(page, "edit-agent-llm-provider", "Databricks v2");
    await expect(advanced).toHaveAttribute("aria-expanded", "false");
    await expect(
      page.getByTestId("edit-agent-advanced-required-badge"),
    ).toHaveText("Required");
    await expect(page.getByTestId("edit-agent-dialog-submit")).toBeDisabled();

    await advanced.click();
    await expect(page.getByLabel("Value for DATABRICKS_HOST")).toBeVisible();
  });

  test("shows baked defaults in the instance editor", async ({ page }) => {
    await installMockBridge(page, {
      bakedBuildEnv: BAKED_DEFAULTS,
      managedAgents: [
        {
          pubkey: AGENT_PUBKEY,
          name: AGENT_NAME,
          status: "stopped",
          channelNames: ["agents"],
        },
      ],
    });

    await openEditDialog(page);

    await expect(page.locator("#edit-agent-llm-provider")).toHaveText(
      "Anthropic (inherited from build)",
    );
    await expect(page.locator("#edit-agent-model")).toHaveText(
      "Inherit build default (claude-opus-4-8)",
    );
    const defaults = page.getByTestId("agent-ai-defaults-notice");
    await expect(
      defaults.getByText("Anthropic", { exact: true }),
    ).toBeVisible();
    await expect(
      defaults.getByText("claude-opus-4-8", { exact: true }),
    ).toBeVisible();
  });

  test("explicit global defaults override baked labels in the instance editor", async ({
    page,
  }) => {
    await installMockBridge(page, {
      bakedBuildEnv: BAKED_DEFAULTS,
      globalAgentConfig: {
        provider: "anthropic",
        model: "claude-opus-4-5",
        env_vars: { BUZZ_AGENT_THINKING_EFFORT: "low" },
      },
      managedAgents: [
        {
          pubkey: AGENT_PUBKEY,
          name: AGENT_NAME,
          status: "stopped",
          channelNames: ["agents"],
        },
      ],
    });

    await openEditDialog(page);

    await expect(page.locator("#edit-agent-llm-provider")).toHaveText(
      "Use agent defaults (anthropic)",
    );
    await expect(page.locator("#edit-agent-model")).toHaveText(
      "Use agent defaults (claude-opus-4-5)",
    );
    const defaults = page.getByTestId("agent-ai-defaults-notice");
    await expect(
      defaults.getByText("Anthropic", { exact: true }),
    ).toBeVisible();
    await expect(
      defaults.getByText("claude-opus-4-5", { exact: true }),
    ).toBeVisible();
  });

  test("profile Edit routes persona-linked agents to the live instance editor", async ({
    page,
  }) => {
    // The live instance is authoritative for access, even when it inherits
    // its configuration from a linked definition. This fixture deliberately
    // disagrees so the profile action cannot accidentally seed from persona
    // defaults again.
    await installMockBridge(page, {
      managedAgents: [
        {
          pubkey: AGENT_PUBKEY,
          name: AGENT_NAME,
          personaId: PERSONA_ID,
          status: "running",
          channelNames: ["agents"],
          respondTo: "owner-only",
        },
      ],
      personas: [
        {
          id: PERSONA_ID,
          displayName: "Edit E2E Persona",
          systemPrompt: "You are the edit-agent e2e persona.",
          behavior: { respondTo: "anyone", respondToAllowlist: [] },
        },
      ],
    });

    await page.goto("/");
    await page.getByTestId("open-agents-view").click();

    // Persona-linked agents render grouped under the persona's card name.
    const agentButton = page.getByRole("button", {
      name: "Edit E2E Persona agent profile",
    });
    await expect(agentButton).toBeVisible({ timeout: 10_000 });
    await agentButton.click();

    await expect(page.getByTestId("user-profile-panel")).toBeVisible({
      timeout: 10_000,
    });
    await page.getByTestId("user-profile-edit-agent").click();

    await expect(page.getByTestId("edit-agent-dialog")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("persona-dialog")).not.toBeVisible();
    await expect(page.locator("#agent-respond-to")).toHaveText(
      "Only me (default)",
    );
    await expect(page.getByTestId("agent-access-warning")).not.toBeVisible();

    const commandLogStart = await page.evaluate(
      () => window.__BUZZ_E2E_COMMAND_LOG__?.length ?? 0,
    );
    await pickDropdownOption(page, "agent-respond-to", "Anyone");
    await page.getByTestId("edit-agent-dialog-submit").click();
    await expect(
      page.getByText(
        "Access saved. Buzz will restart this agent after it is connected and idle for about three minutes.",
      ),
    ).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate((start) => {
          const commands = window.__BUZZ_E2E_COMMAND_LOG__ ?? [];
          return commands
            .slice(start)
            .some(
              (entry) =>
                entry.command === "update_managed_agent" &&
                (entry.payload as { input?: { respondTo?: string } })?.input
                  ?.respondTo === "anyone",
            );
        }, commandLogStart),
      )
      .toBe(true);
    const commands = await page.evaluate(
      () => window.__BUZZ_E2E_COMMAND_LOG__ ?? [],
    );
    expect(
      commands
        .slice(commandLogStart)
        .some((entry) => entry.command === "update_persona"),
    ).toBe(false);
    await expect(page.getByTestId("restart-diff-badge")).toBeVisible();

    await page.getByTestId("user-profile-agent-restart").click();
    await expect(page.getByTestId("restart-diff-badge")).not.toBeVisible();
    await page.getByTestId("user-profile-edit-agent").click();
    await expect(page.locator("#agent-respond-to")).toHaveText("Anyone");
  });

  test("manual restart guidance is shown when automatic restart is disabled", async ({
    page,
  }) => {
    await installMockBridge(page, {
      managedAgents: [
        {
          pubkey: AGENT_PUBKEY,
          name: AGENT_NAME,
          status: "running",
          channelNames: ["agents"],
          respondTo: "owner-only",
          autoRestartOnConfigChange: false,
        },
      ],
    });

    await openEditDialog(page);
    await pickDropdownOption(page, "agent-respond-to", "Anyone");
    await page.getByTestId("edit-agent-dialog-submit").click();

    await expect(
      page.getByText(
        "Access saved. Use Restart Agent on the profile to apply it.",
      ),
    ).toBeVisible();
    await expect(page.getByTestId("restart-diff-badge")).toBeVisible();
  });

  test("unchanged access does not show lifecycle feedback or create restart drift", async ({
    page,
  }) => {
    await installMockBridge(page, {
      managedAgents: [
        {
          pubkey: AGENT_PUBKEY,
          name: AGENT_NAME,
          status: "running",
          channelNames: ["agents"],
          respondTo: "owner-only",
        },
      ],
    });

    await openEditDialog(page);
    await page.getByTestId("edit-agent-dialog-submit").click();

    await expect(page.getByTestId("edit-agent-dialog")).not.toBeVisible();
    await expect(page.getByText(/^Access saved\./)).toHaveCount(0);
    await expect(page.getByTestId("restart-diff-badge")).toHaveCount(0);
  });

  test("stopped agents offer an explicit start recovery after an access save", async ({
    page,
  }) => {
    await installMockBridge(page, {
      managedAgents: [
        {
          pubkey: AGENT_PUBKEY,
          name: AGENT_NAME,
          status: "stopped",
          channelNames: ["agents"],
          respondTo: "owner-only",
        },
      ],
    });

    await openEditDialog(page);
    await pickDropdownOption(page, "agent-respond-to", "Anyone");
    await page.getByTestId("edit-agent-dialog-submit").click();

    await expect(
      page.getByText(`${AGENT_NAME} saved while stopped.`),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Start now" })).toBeVisible();
  });
});
