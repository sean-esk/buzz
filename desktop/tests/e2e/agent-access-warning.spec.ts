import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const SHOTS = "test-results/agent-access-warning";

async function choosePersonaAccess(
  page: import("@playwright/test").Page,
  optionName: string,
) {
  await page.locator("#agent-respond-to").click();
  await page.getByRole("menuitemradio", { name: optionName }).click();
}

async function openAgentAccessDialog(
  page: import("@playwright/test").Page,
  agentPubkey: string,
) {
  if (!(await page.getByTestId("members-sidebar").isVisible())) {
    await page.getByTestId("channel-general").click();
    await page.getByTestId("channel-members-trigger").click();
    await expect(page.getByTestId("members-sidebar")).toBeVisible();
  }

  const row = page.getByTestId(`sidebar-member-${agentPubkey}`);
  const menu = page.getByTestId(`sidebar-member-menu-${agentPubkey}`);
  await row.hover();
  await menu.focus();
  await menu.press("Enter");
  await page.getByTestId(`sidebar-edit-respond-to-${agentPubkey}`).click();

  await expect(
    page.getByRole("dialog", { name: "Manage agent access" }),
  ).toBeVisible();
}

test("open agent access explains the available access before save", async ({
  page,
}) => {
  const agent = TEST_IDENTITIES.charlie;
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: agent.pubkey,
        name: "Hack Day Helper",
        status: "running",
        channelNames: ["general"],
        respondTo: "owner-only",
      },
    ],
  });
  await page.goto("/");
  await openAgentAccessDialog(page, agent.pubkey);

  const accessSelect = page.getByTestId("agent-respond-to-select");
  await expect(accessSelect).toHaveValue("owner-only");
  await expect(page.getByTestId("agent-access-warning")).toHaveCount(0);
  const saveAccess = page.getByRole("button", { name: "Save access" });
  await expect(saveAccess).toBeVisible();

  const commandsBeforeSave = await page.evaluate(
    () => window.__BUZZ_E2E_COMMAND_LOG__?.length ?? 0,
  );
  await accessSelect.selectOption("anyone");
  const warning = page.getByTestId("agent-access-warning");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText(
    "Anyone can use this agent to access your computer, including files, accounts, and connected tools.",
  );

  await waitForAnimations(page);
  await page
    .getByRole("dialog", { name: "Manage agent access" })
    .screenshot({ path: `${SHOTS}/open-access-warning.png` });

  await saveAccess.click();
  await expect(
    page.getByRole("dialog", { name: "Manage agent access" }),
  ).not.toBeVisible();
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
      }, commandsBeforeSave),
    )
    .toBe(true);

  await openAgentAccessDialog(page, agent.pubkey);
  await expect(accessSelect).toHaveValue("anyone");
  // Selected people narrows the audience but not the access, so the warning
  // persists with its own audience phrase.
  await accessSelect.selectOption("allowlist");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText(
    "Selected people can use this agent to access your computer, including files, accounts, and connected tools.",
  );
  const picker = page.getByTestId("agent-respond-to-allowlist");
  await expect(
    picker.getByText("Selected people", { exact: true }),
  ).toBeVisible();

  // The warning sits below the picker so it never blocks the selection the
  // user came here to make.
  await waitForAnimations(page);
  const pickerBox = await picker.boundingBox();
  const warningBox = await warning.boundingBox();
  expect(pickerBox?.y).toBeDefined();
  expect(warningBox?.y).toBeGreaterThan(pickerBox?.y ?? 0);
  await page
    .getByRole("dialog", { name: "Manage agent access" })
    .screenshot({ path: `${SHOTS}/selected-people-warning.png` });

  // Only me shares nothing, so the warning goes away entirely.
  await accessSelect.selectOption("owner-only");
  await expect(warning).toHaveCount(0);
});

test("a provider-backed agent's warning names the server, not this computer", async ({
  page,
}) => {
  const agent = TEST_IDENTITIES.charlie;
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: agent.pubkey,
        name: "Remote Helper",
        status: "running",
        channelNames: ["general"],
        respondTo: "owner-only",
        backend: { type: "provider", id: "blox", config: {} },
      },
    ],
  });
  await page.goto("/");
  await openAgentAccessDialog(page, agent.pubkey);

  await page.getByTestId("agent-respond-to-select").selectOption("anyone");
  const warning = page.getByTestId("agent-access-warning");
  await expect(warning).toContainText(
    "Anyone can use this agent to access the server it runs on, including any accounts and tools available there.",
  );
  // The local wording must not leak into a remote-backed agent.
  await expect(warning).not.toContainText("your computer");

  await page.getByRole("button", { name: "Save access" }).click();
  await expect(
    page.getByText(
      "Access saved. Shut down and deploy this agent again to apply it.",
    ),
  ).toBeVisible();
  await expect(page.getByTestId("restart-diff-badge")).toHaveCount(0);
});

test("channel access save gives automatic local restart guidance from the returned agent", async ({
  page,
}) => {
  const agent = TEST_IDENTITIES.charlie;
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: agent.pubkey,
        name: "Automatic Local Helper",
        status: "running",
        channelNames: ["general"],
        respondTo: "owner-only",
        autoRestartOnConfigChange: true,
      },
    ],
  });
  await page.goto("/");
  await openAgentAccessDialog(page, agent.pubkey);

  const commandLogStart = await page.evaluate(
    () => window.__BUZZ_E2E_COMMAND_LOG__?.length ?? 0,
  );
  await page.getByTestId("agent-respond-to-select").selectOption("anyone");
  await page.getByRole("button", { name: "Save access" }).click();

  await expect(
    page.getByText(
      "Access saved. Buzz will restart this agent after it is connected and idle for about three minutes.",
    ),
  ).toBeVisible();
  const commands = await page.evaluate(
    () => window.__BUZZ_E2E_COMMAND_LOG__ ?? [],
  );
  expect(
    commands
      .slice(commandLogStart)
      .map((entry) => entry.command)
      .filter((command) => command === "update_managed_agent"),
  ).toEqual(["update_managed_agent"]);
});

test("channel access save gives manual local restart guidance when automatic restart is disabled", async ({
  page,
}) => {
  const agent = TEST_IDENTITIES.charlie;
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: agent.pubkey,
        name: "Manual Local Helper",
        status: "running",
        channelNames: ["general"],
        respondTo: "owner-only",
        autoRestartOnConfigChange: false,
      },
    ],
  });
  await page.goto("/");
  await openAgentAccessDialog(page, agent.pubkey);

  const commandLogStart = await page.evaluate(
    () => window.__BUZZ_E2E_COMMAND_LOG__?.length ?? 0,
  );
  await page.getByTestId("agent-respond-to-select").selectOption("anyone");
  await page.getByRole("button", { name: "Save access" }).click();

  await expect(
    page.getByText(
      "Access saved. Use Restart Agent on the profile to apply it.",
    ),
  ).toBeVisible();
  const commands = await page.evaluate(
    () => window.__BUZZ_E2E_COMMAND_LOG__ ?? [],
  );
  expect(
    commands
      .slice(commandLogStart)
      .map((entry) => entry.command)
      .filter((command) => command === "update_managed_agent"),
  ).toEqual(["update_managed_agent"]);
});

test("unchanged channel access save skips lifecycle feedback and restart drift", async ({
  page,
}) => {
  const agent = TEST_IDENTITIES.charlie;
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: agent.pubkey,
        name: "Unchanged Local Helper",
        status: "running",
        channelNames: ["general"],
        respondTo: "owner-only",
      },
    ],
  });
  await page.goto("/");
  await openAgentAccessDialog(page, agent.pubkey);

  const commandLogStart = await page.evaluate(
    () => window.__BUZZ_E2E_COMMAND_LOG__?.length ?? 0,
  );
  await page.getByRole("button", { name: "Save access" }).click();

  await expect(page.getByText(/^Access saved\./)).toHaveCount(0);
  await expect(page.getByTestId("restart-diff-badge")).toHaveCount(0);
  const commands = await page.evaluate(
    () => window.__BUZZ_E2E_COMMAND_LOG__ ?? [],
  );
  expect(
    commands
      .slice(commandLogStart)
      .map((entry) => entry.command)
      .filter((command) => command === "update_managed_agent"),
  ).toEqual(["update_managed_agent"]);
});

test("a rejected channel access save stays inline without an unhandled rejection", async ({
  page,
}) => {
  const agent = TEST_IDENTITIES.charlie;
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await installMockBridge(page, {
    updateManagedAgentErrors: ["Mock access save failed."],
    managedAgents: [
      {
        pubkey: agent.pubkey,
        name: "Hack Day Helper",
        status: "running",
        channelNames: ["general"],
        respondTo: "owner-only",
      },
    ],
  });
  await page.goto("/");
  await openAgentAccessDialog(page, agent.pubkey);

  await page.getByTestId("agent-respond-to-select").selectOption("anyone");
  await page.getByRole("button", { name: "Save access" }).click();

  await expect(
    page.getByText("Mock access save failed.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Manage agent access" }),
  ).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("persona-backed edit warns before saving open access", async ({
  page,
}) => {
  const agent = TEST_IDENTITIES.tyler;
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: agent.pubkey,
        name: "Tyler Agent",
        status: "stopped",
        channelNames: ["agents"],
        respondTo: "owner-only",
      },
    ],
  });
  await page.goto("/");
  await page.getByTestId("open-agents-view").click();
  await page.getByRole("button", { name: "Tyler Agent agent profile" }).click();
  await page.getByTestId("user-profile-edit-agent").click();

  const dialog = page.getByTestId("edit-agent-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#agent-respond-to")).toHaveText(
    "Only me (default)",
  );
  await choosePersonaAccess(page, "Anyone");
  await expect(dialog.getByTestId("agent-access-warning")).toContainText(
    "Anyone can use this agent to access your computer, including files, accounts, and connected tools.",
  );

  const commandsBeforeSave = await page.evaluate(
    () => window.__BUZZ_E2E_COMMAND_LOG__?.length ?? 0,
  );
  await page.getByTestId("edit-agent-dialog-submit").click();
  await expect(dialog).not.toBeVisible();
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
      }, commandsBeforeSave),
    )
    .toBe(true);
});
