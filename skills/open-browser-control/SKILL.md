---
name: open-browser-control
description: Operate the user's existing Chrome or Firefox login session through Open Browser Control. Use for browser tasks that need authenticated pages, interactive forms, or user handoff for login. Prefer ordinary HTTP or search tools when browser state is unnecessary.
---

# Open Browser Control

Use the connected Open Browser Control MCP tools. The browser extension alone is
not sufficient: a local bridge and an agent-side MCP connection must also exist.
Tool names may have client-specific prefixes; inspect the available schemas.

## Connect and establish scope

- Verify the connection before claiming access. If tools are missing, consult the
  repository's README for MCP setup. Do not silently install software, change
  agent configuration, or disable connection checks to get around a failure.
- Give the session a task-specific name. List its tabs before creating another.
  The tab list is session-scoped; an empty list does not mean the browser is empty.
- Prefer a new task tab unless the user specifically needs an existing tab's state.
  A new tab in the same profile normally reuses the user's website login. Do not
  extract cookies or passwords into scripts to reproduce that login elsewhere.
- Establish the exact site, account/project, and requested mutation scope before
  acting. Access to a logged-in account is not authorization to change everything
  in it. Keep unrelated tabs and other agents' sessions untouched.
- The bridge is local to the browser's machine. A remote agent cannot reach it
  merely by registering `localhost:9334` on a different machine.

## Read, act, verify

- Start with page metadata and scoped DOM inspection. Use screenshots when layout,
  canvas content, or visual confirmation matters, rather than for every action.
- Use selectors derived from the live DOM and scoped to the exact record or dialog.
  In repeated tables, a global button label such as "Delete" is not precise enough.
- Sequence dependent operations: wait for one result before sending the next.
  After navigation or submission, inspect the new state instead of trusting the
  click result alone. Re-read dynamic identifiers after each page reload.
- If JavaScript evaluation returns an unexpected null/empty result, use DOM tools
  to verify what happened. A successful transport response is not proof that the
  expression ran or that a mutation succeeded.
- Use the user-handoff tool when login, MFA, CAPTCHA, or another human-only step
  is required. Resume only after the expected account/page state is visible.

## Destructive and batch operations

- Obtain clear authorization for the target and range if it is not already given.
  For example, "development releases through version X" excludes stable releases
  and newer development releases. Do not infer ordering from lexical sorting.
- Enumerate the exact targets and summarize the impact before a batch. Preserve
  an allowlist rather than repeatedly selecting "the next row" as rows disappear.
- For each target, verify the record identity and confirmation-dialog identity,
  then perform the action and check its success state. Existing explicit batch
  authorization need not be requested again for every matching record.
- Stop on a mismatched identity, unexpected confirmation, or ambiguous outcome.
  A timeout may follow a successful mutation: inspect state before retrying.
- Keep a minimal audit of identifiers and outcomes, not full pages or session
  secrets. Afterward, verify both the requested changes and the protected items.
  Public indexes can lag authenticated management pages; distinguish propagation
  delay from an unsuccessful mutation.

## Shared bridge and cleanup

- Each agent has its own session and tabs, but shares the browser profile and
  website accounts. Coordinate concurrent writes to the same project or account;
  session routing is not an authorization or credential-isolation boundary.
- Never reuse another agent's session ID. Disconnect only your own client when
  finished. Do not kill a shared bridge or close user tabs as routine cleanup.
- If you started a private bridge for a temporary task, stop it afterward only
  once it is known not to serve another agent. The MCP launcher may leave a shared
  detached bridge running after its client exits.
- Keep the bridge loopback-only. Host/Origin checks reduce exposure to websites,
  but do not authenticate local processes or browser extensions. Do not expose it
  through a public listener or tunnel as a substitute for authenticated access.
- Report completed actions, anything left unresolved, and material side effects.
