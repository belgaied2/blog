---
title: "macOS Local Network Privacy: why your CLI gets EHOSTUNREACH and how to fix it"
summary: "Why a CLI or a background service cannot reach your LAN on macOS, what EHOSTUNREACH really means, and the signed .app wrapper that fixes it."
date: 2026-10-22T09:00:00+02:00
draft: false
author: Mohamed Belgaied Hassine
comments: true
description: "curl reaches the LAN, your own binary gets EHOSTUNREACH, and nothing appears in System Settings. Here is what macOS is actually doing, and the .app wrapper that fixes it."
tags:
  - macOS
  - Networking
  - OpenCode
  - MCP
keywords:
  - macOS
  - Local Network Privacy
  - EHOSTUNREACH
  - FailedToOpenSocket
  - launchd
  - OpenCode
  - MCP
  - Ollama
---

If you run a local model server, an MCP server, or anything else on your LAN, you have probably hit this: `curl http://192.168.1.50:11434/v1/models` returns a model list, `nc -vz 192.168.1.50 11434` succeeds, and your tool still fails with:

```
AI_APICallError: Cannot connect to API: Was there a typo in the url or port?
  cause: Error: Was there a typo in the url or port?
   code: "FailedToOpenSocket"
```

or, from Node:

```
connect EHOSTUNREACH 192.168.1.50:11434
```

The URL is right, the port is open, and the server is up. The error is misleading, because the connection never leaves your machine.

This is macOS Local Network Privacy, and it is not a bug in your tool. It is a permission decision that macOS makes about *which program* is opening the socket, and it fails silently.

## The symptom that gives it away

The failure follows the process, not the destination. On the same Mac, at the same moment:

| Client | `192.168.1.50:11434` |
|---|---|
| `/usr/bin/curl` | 200 |
| `/usr/bin/ssh`, `/usr/bin/nc` | connects |
| Homebrew Python | `EHOSTUNREACH` |
| A Go or C binary you compiled yourself | `EHOSTUNREACH` |
| OpenCode background service | `FailedToOpenSocket` |

Same IP, same route, same credentials. Only the binary changes the outcome. That is the signature of a code-signing-based network policy, not a routing problem.

## What macOS is doing

Apple documents this in [TN3179: Understanding local network privacy](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy). The parts that matter here:

- Local network privacy gates outgoing TCP and UDP to addresses on a broadcast-capable interface, so Wi-Fi and Ethernet. VPN and tunnel interfaces are not affected, which is why a Tailscale address works when a `192.168` one does not.
- It is enforced in the network stack, not in TCC. There is no `tccutil` equivalent, MDM cannot configure it, and a denied connection returns `EHOSTUNREACH` before a packet is sent.
- Access is granted per program identity. A bare Mach-O binary has no `CFBundleIdentifier` and no `NSLocalNetworkUsageDescription`, so macOS has nothing to show in a prompt and nothing to store a decision against. The connection is denied and you never see a dialog.
- Command-line tools run from Terminal or over SSH are allowed, including their child processes. Launch daemons are allowed. Launch *agents* are not on that list.

That last point is the trap. OpenCode, like several other tools, starts a persistent server and reparents it to `launchd`:

```console
$ ps -o pid,ppid,command -p 25455
  PID  PPID COMMAND
25455     1 /opt/homebrew/bin/opencode serve --service
```

`PPID 1` means it is no longer a child of your terminal. It is not a daemon either. It falls into the gap: not exempt, not attributable, not prompted. Every socket it opens to the LAN is denied, no matter which HTTP client or runtime opens it. That is why this looks like a Bun, Node, or undici bug and is not one.

You can confirm the launch context is the variable without changing anything else:

```console
$ opencode --standalone   # from Terminal.app
```

`--standalone` keeps the server in the foreground as a child of the terminal, so the terminal exemption applies and the LAN endpoint connects immediately. Same config, same binary, different parent.

## The fix: give the service a bundle identity

The durable fix is to run the service from inside a signed `.app` bundle and tell `launchd` that the job belongs to that bundle. Then macOS has an identity it can prompt for, and the grant is stored and reused.

The layout:

```
OpenCode.app/
  Contents/
    Info.plist
    MacOS/opencode
```

`Contents/Info.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>         <string>dev.example.opencode</string>
  <key>CFBundleExecutable</key>         <string>opencode</string>
  <key>CFBundleName</key>               <string>OpenCode</string>
  <key>CFBundlePackageType</key>        <string>APPL</string>
  <key>CFBundleShortVersionString</key> <string>2.1.2</string>
  <key>CFBundleVersion</key>            <string>2.1.2</string>
  <key>LSBackgroundOnly</key>           <true/>
  <key>NSLocalNetworkUsageDescription</key>
  <string>OpenCode connects to model servers, MCP servers, and other services on your local network.</string>
</dict>
</plist>
```

The launch agent, in `~/Library/LaunchAgents/dev.example.opencode.plist`:

```xml
<key>ProgramArguments</key>
<array>
  <string>/Applications/OpenCode.app/Contents/MacOS/opencode</string>
  <string>serve</string>
  <string>--service</string>
</array>
<key>AssociatedBundleIdentifiers</key>
<array>
  <string>dev.example.opencode</string>
</array>
```

`AssociatedBundleIdentifiers` is the part people miss. It is what tells macOS that this launchd job is the bundle, and it does nothing if the bundle does not exist on disk with a matching identifier.

Then sign the bundle, not just the executable, so the `Info.plist` is covered:

```console
$ codesign --force --deep --sign - OpenCode.app
```

An ad-hoc signature (`-`) is enough to get the prompt on a personal machine. If you distribute the wrapper, use a Developer ID and a stable identifier: the grant is keyed to the designated requirement, so a signature that changes on every build means a new grant every time.

## What it looks like when it works

On my machine, before the wrapper, every LAN connection from the service failed with `errno 65`. After wrapping the exact same binary and loading the agent:

```
ERR  connect 192.168.1.47:8000  errno=65  No route to host
ERR  connect 192.168.1.47:8000  errno=65  No route to host
OK   connected
```

The two failures are the first attempts, before macOS showed the dialog. The third is after clicking **Allow** on "OpenCode wants to access devices on your local network". The grant survives service restarts and reboots, and the MCP server on the LAN then works with no SSH tunnel and no proxy environment variable.

## Workarounds that do not require a wrapper

Ranked by how much I trust them:

1. **`opencode --standalone` from Terminal.app.** Uses the documented terminal exemption. Cost: no shared background service, sessions end with the terminal.
2. **Point at a VPN address.** LNP only covers broadcast-capable interfaces, so a Tailscale or WireGuard address is not gated. Cost: the service must be reachable on the tailnet.
3. **Loopback forward.** `ssh -N -L 127.0.0.1:8000:127.0.0.1:8000 user@host` keeps traffic on the LAN and uses Apple's `ssh`, which is exempt. Cost: another moving part.
4. **A machine-wide subnet exemption.** Documented in TN3179 since macOS 15.5. It applies to every process, not just the one you care about, and requires a reboot:

   ```console
   $ sudo defaults write com.apple.network.local-network AllowedEthernetLocalNetworkAddresses -array "192.168.1.0/24"
   $ sudo defaults write com.apple.network.local-network AllowedWiFiLocalNetworkAddresses -array "192.168.1.0/24"
   $ sudo reboot
   ```

   This is the right answer for a CI machine or a lab host. It is a heavy hammer for a laptop.

## The caveats

Two things are worth knowing before you spend an evening on this.

First, wrapping is not universal. Reports from Electron apps show that a fresh bundle identifier sometimes never prompts at all, because the responsible process resolves to `(null)` and the system falls back to the framework's own grant state. In that case the bundle is not enough, and the app has to be launched by a process whose identity macOS can resolve. Native binaries wrapped and loaded through a launch agent, which is the case here, do get the prompt. So treat the wrapper as the mechanism, not a guarantee, and verify on the target machine.

Second, the grant state is not in TCC. It lives in `/Library/Preferences/com.apple.networkextension.plist` under `PathController.Rules`, keyed by `SigningIdentifier` or executable path. Reading it is the fastest way to see whether a program is granted, denied, or still undetermined, and it explains why some entries in System Settings look decorative: the rule that matters may be attached to an interpreter or framework rather than to the app you are staring at.

## Why this matters beyond one tool

Every agentic tool that talks to something on your LAN now runs into this: a local model server, a remote MCP endpoint, a database in the homelab. The pattern is always the same. The process that opens the socket is not the process you think it is, and macOS makes a decision about that process without telling you.

If you maintain a CLI that ships a background service, the fix belongs in your packaging, not in your users' shell profiles. Ship a bundle, sign it, and associate the launch agent. If you use one, `--standalone` will get you through the afternoon.

I filed the upstream report for OpenCode with the full evidence: [anomalyco/opencode#58080](https://github.com/anomalyco/opencode/issues/58080). The issue references three earlier reports with the same root cause, all closed without a fix.
