---
title: "Wrapping OpenCode in a .app to fix macOS LAN access"
description: "The full recipe: an app bundle with a bundle identifier, a launch agent that claims it, ad-hoc signing, the cutover, and what to redo after every upgrade."
summary: "The full recipe: an app bundle with a bundle identifier, a launch agent that claims it, ad-hoc signing, the cutover, and what to redo after every upgrade."
date: 2026-11-12T10:00:00+01:00
tags:
  - macOS
  - Networking
  - OpenCode
  - MCP
keywords:
  - OpenCode
  - macOS
  - Local Network Privacy
  - launchd
  - codesign
  - app bundle
  - MCP
---

[Last time](/blog/macos/local-network-privacy/) I explained *why* a background service on macOS 15+ cannot reach your LAN: Local Network Privacy gates sockets by program identity, and a bare CLI started by `launchd` has no identity to gate. This post is the other half — the wrapper itself, with the actual files, the cutover, and the parts that need redoing after every upgrade.

If you only want the summary: eight files, one `codesign` command, one `launchctl` bootstrap, and a note in your calendar for whenever the tool updates.

## What we are building

```
~/Applications/OpenCode LAN.app/
└── Contents/
    ├── Info.plist                    bundle identity + usage description
    ├── MacOS/opencode                a copy of the real binary
    └── _CodeSignature/CodeResources  created by codesign
```

plus `~/Library/LaunchAgents/dev.example.opencode.plist`, which runs `opencode serve --service` from inside the bundle and tells `launchd` that this job *is* that bundle.

Three things make it work, and all three are required:

1. A `CFBundleIdentifier`, so macOS has a name to remember.
2. `NSLocalNetworkUsageDescription`, so the prompt has something to say.
3. `AssociatedBundleIdentifiers` in the launch agent, so the detached service is attributed to the bundle rather than to nothing.

Miss any one and you are back to a silent `EHOSTUNREACH`.

## Step 1: assemble the bundle

Create the directory and copy the binary. On Apple Silicon with Homebrew that is `/opt/homebrew/bin/opencode`; on Intel, `/usr/local/bin/opencode`.

```bash
APP="$HOME/Applications/OpenCode LAN.app"
mkdir -p "$APP/Contents/MacOS"

# -L because the Homebrew path is usually a symlink into the Cellar
cp -L /opt/homebrew/bin/opencode "$APP/Contents/MacOS/opencode"
chmod +x "$APP/Contents/MacOS/opencode"
```

A note on the copy: the bundle must contain a *file*, not a symlink into the Homebrew Cellar. If you leave the symlink in place, `codesign` will sign the Cellar binary instead, and the next `brew upgrade` will invalidate it in a way that is annoying to debug.

Now the `Info.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDisplayName</key>          <string>OpenCode</string>
    <key>CFBundleExecutable</key>           <string>opencode</string>
    <key>CFBundleIdentifier</key>           <string>dev.example.opencode</string>
    <key>CFBundleName</key>                 <string>OpenCode</string>
    <key>CFBundlePackageType</key>          <string>APPL</string>
    <key>CFBundleShortVersionString</key>   <string>1.0</string>
    <key>CFBundleVersion</key>              <string>1.0</string>
    <key>LSBackgroundOnly</key>             <true/>
    <key>NSLocalNetworkUsageDescription</key>
    <string>OpenCode connects to model servers, MCP servers and other services on your local network.</string>
</dict>
</plist>
```

Two details worth understanding:

- **`LSBackgroundOnly`** keeps the app out of the Dock and the app switcher. You are not launching a GUI; you are giving a background service a name badge.
- **`NSLocalNetworkUsageDescription`** is the sentence macOS shows in the permission dialog. Write it for a person who is about to decide whether you get network access — "OpenCode needs network access" is not an answer to that question.

The identifier is yours to choose. Anything reverse-DNS-shaped works; it only has to stay stable, because the grant is remembered against it.

## Step 2: the launch agent

Save this as `~/Library/LaunchAgents/dev.example.opencode.plist`. Change the paths and the identifier to match yours.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>dev.example.opencode</string>

    <key>ProgramArguments</key>
    <array>
        <string>/Users/you/Applications/OpenCode LAN.app/Contents/MacOS/opencode</string>
        <string>serve</string>
        <string>--service</string>
    </array>

    <key>AssociatedBundleIdentifiers</key>
    <array>
        <string>dev.example.opencode</string>
    </array>

    <key>ProcessType</key>
    <string>Interactive</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>WorkingDirectory</key>
    <string>/Users/you</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>  <string>/Users/you</string>
        <key>PATH</key>  <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>SHELL</key> <string>/bin/zsh</string>
    </dict>

    <key>StandardOutPath</key>
    <string>/Users/you/Library/Logs/opencode-service.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/you/Library/Logs/opencode-service.log</string>
</dict>
</plist>
```

`AssociatedBundleIdentifiers` is the line everyone forgets. Without it, `launchd` starts a process that belongs to no bundle, macOS falls through to its deny-by-default rule, and you get the same `EHOSTUNREACH` you had before — with a perfectly good bundle sitting on disk, unused.

The explicit `PATH` matters too, for a duller reason: launch agents do not inherit your shell environment. Without it, anything the service shells out to — `npx` for an MCP server, `git`, `ssh` — is not found. That failure looks like the MCP server being broken, not like a missing path.

## Step 3: sign it

```bash
codesign --force --deep --sign - "$HOME/Applications/OpenCode LAN.app"
codesign --verify --deep --strict "$HOME/Applications/OpenCode LAN.app"
```

`--sign -` means ad-hoc. Ad-hoc signatures are fine for a bundle that never leaves your machine, and — this is the part that surprises people — **sufficient for Local Network Privacy**. macOS does not require a Developer ID here; it requires an *identity*, and an ad-hoc signature supplies one.

The trade-off is durability. The grant is keyed to the signature, and an ad-hoc signature is a hash of the binary. Copy a new binary in, and the hash changes, and the grant no longer matches. More on that in the upgrade section.

## Step 4: the cutover, from a real terminal

This is the step that bites. `opencode` runs a background service, and the service is what serves the session you are typing into. Stopping it from inside itself ends your session mid-command.

So: quit OpenCode, open **Terminal.app**, and run:

```bash
# stop the stock service
opencode service stop

# load the wrapped one
launchctl bootout gui/$(id -u)/dev.example.opencode 2>/dev/null || true
launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/dev.example.opencode.plist"

# confirm it is running
launchctl print gui/$(id -u)/dev.example.opencode | grep -E 'state =|pid ='
```

You should see `state = running` and a PID. Then start OpenCode in a new terminal window.

## Step 5: the prompt

The first LAN connection from the wrapped service triggers the dialog:

> **OpenCode** wants to access devices on your local network.

Click **Allow**. Then verify — because "it seemed to work" is not verification:

```bash
opencode service status
opencode api get /api/info
```

and then exercise the actual thing you care about: a remote MCP server, or a model server on another machine. What you are looking for is the absence of:

```
AI_APICallError: Cannot connect to API: Was there a typo in the url or port?
  code: "FailedToOpenSocket"
```

If the prompt never appears, check three things in order: the launch agent actually has `AssociatedBundleIdentifiers`, its value matches `CFBundleIdentifier` character for character, and the binary inside the bundle is a real file rather than a symlink.

## Verifying the mechanism, not just the outcome

The reason I trust this fix is not that it worked. It is that the failure and the success differ in exactly one variable.

Before the wrapper, same binary, same config, same network:

```
ERR  connect 192.168.1.47:8000  errno=65  No route to host
ERR  connect 192.168.1.47:8000  errno=65  No route to host
```

After loading the agent and clicking Allow:

```
OK   connected
```

The two failures are the pre-prompt attempts. Nothing else changed — not the config, not the server, not the network. That is what a permissions problem looks like when you finally see it, and it is why I stopped believing the earlier theories about DNS, undici and Bun.

## The upgrade problem

This is the part that decides whether the approach is worth it.

Every time OpenCode updates, the bundle contains an old binary. Refresh it:

```bash
#!/bin/zsh
set -euo pipefail

APP="$HOME/Applications/OpenCode LAN.app"
LABEL="dev.example.opencode"

cp -L /opt/homebrew/bin/opencode "$APP/Contents/MacOS/opencode"

V=$(/opt/homebrew/bin/opencode --version | head -1)
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $V" "$APP/Contents/Info.plist" || true
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $V" "$APP/Contents/Info.plist" || true

codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

launchctl kickstart -k "gui/$(id -u)/$LABEL"
```

Then expect to click **Allow** again on the next LAN connection. That is not a bug in the wrapper — it is the ad-hoc signature changing, which invalidates the grant. It is also the reason the proper fix has to come from upstream: only a stable Developer ID signature gives you an identity that survives updates.

Keep a rollback script too, because you will want it at 23:00 on a Sunday:

```bash
#!/bin/zsh
launchctl bootout "gui/$(id -u)/dev.example.opencode" 2>/dev/null || true
opencode service start
opencode service status
```

## When this is the wrong tool

Three cases where I would not bother:

- **You only use the TUI.** `opencode --standalone` keeps the server as a child of your terminal, which is exempt. No bundle, no signing, no maintenance. The cost is that sessions end with the terminal.
- **The service is reachable over a VPN address.** Local Network Privacy does not gate tunnelled traffic, so pointing at a Tailscale or WireGuard address sidesteps the problem entirely.
- **You are on a longer timeframe than one machine.** An SSH tunnel to `127.0.0.1` uses Apple's `ssh`, which is exempt, and costs one line in a launch agent.

The wrapper earns its keep when you want the persistent background service, the MCP server on the LAN, and no extra moving parts on the network side. That is my case, and it has held for three weeks and four restarts.

## What I would still like upstream

Even with the wrapper working, the shipped binary still has no bundle. Three changes would make all of this unnecessary for everyone:

1. Ship a minimal `.app` (or an embedded `Info.plist`) with a bundle identifier and a local-network usage description.
2. Run the background service from inside it.
3. Put `AssociatedBundleIdentifiers` on the service registration.

I filed that as [anomalyco/opencode#58080](https://github.com/anomalyco/opencode/issues/58080) with the evidence and the recipes above. Three earlier reports — [#25908](https://github.com/anomalyco/opencode/issues/25908), [#38854](https://github.com/anomalyco/opencode/issues/38854), [#37432](https://github.com/anomalyco/opencode/issues/37432) — were closed without a fix, and the failure survives into 2.x.

Until then: eight files, one signature, and a script to re-run after every upgrade.

## Related posts

- [macOS Local Network Privacy: why your CLI gets EHOSTUNREACH](/blog/macos/local-network-privacy/) — the diagnosis: what LNP actually gates, and why `launchd` is the gap.
