# Windows client agent (initial pilot)

This Windows 10/11 companion displays incoming support requests, requires the
local user to approve or reject them, opens the installed RustDesk client, and
keeps a visible stop control while the request is active. It signs in with an
existing **CLIENT** account. The password is used only for login; the returned
one-day session token is encrypted for the current Windows user with DPAPI.

## Build

Install the .NET Framework 4.8 Developer Pack, then run in PowerShell:

```powershell
.\build.ps1
```

The executable is written to `dist\ServiceRemotoAgent.exe`. The agent uses
Windows Forms and .NET Framework 4.8 and does not require Node.js or the .NET
SDK at runtime. The RustDesk application must be installed separately.

## Pilot limitations

- Start the agent before a technician requests access. Requests are delivered
  only to currently connected agents on the dedicated `/ws/agent` channel;
  an open browser session alone does not count as an agent.
- The customer must approve in this agent **and** accept RustDesk's own
  confirmation prompt. Never configure unattended access or save a permanent
  RustDesk password.
- The agent does not yet inspect or change RustDesk settings. Verify manually
  that unattended access/passwords are disabled; the agent cannot enforce that
  policy in this pilot.
- Client approval is currently local to the agent and is not persisted as a
  consent audit event or enforced as a RustDesk network lock. RustDesk's native
  confirmation is the actual access gate.
- Approval means only that the customer accepted the request. The agent cannot
  yet observe RustDesk's actual session state, so it does not mark
  `connectedAt` or claim that a remote connection is live.
- The red stop action is local-first: after confirmation it terminates
  RustDesk processes in the current Windows session, then asks the API to close
  the ticket. A RustDesk service running in another session or with elevated
  privileges may not be stoppable by this user; the agent shows process/API
  errors rather than claiming success.
- This is an unsigned pilot executable, not a production installer. Do not
  distribute it to customers until signing, update delivery, startup behavior,
  service-mode shutdown, and multi-machine session tests are completed.
