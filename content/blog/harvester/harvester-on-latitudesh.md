---
title: "Installing Harvester on Latitude.sh with Terraform and iPXE"
description: "A Terraform module that buys bare metal on Latitude.sh and installs Harvester unattended over iPXE, including the two things that stop most attempts: UEFI and the network shape."
summary: "A Terraform module that buys bare metal on Latitude.sh and installs Harvester unattended over iPXE, including the two things that stop most attempts: UEFI and the network shape."
date: 2026-11-26T10:00:00+01:00
tags:
  - Harvester
  - Latitude.sh
  - Terraform
  - Bare metal
  - Virtualization
keywords:
  - Harvester
  - Latitude.sh
  - Terraform
  - iPXE
  - bare metal
  - Harvester install
---

Three Harvester nodes on Latitude.sh, installed without anyone touching a console, cost $3.36 an hour and take about 40 minutes from `terraform apply` to a working VIP. That is the whole pitch, and the rest of this post is the two things that will stop you before you get there: firmware mode, and the shape of the network.

Equinix Metal is gone. Harvester's documented bare-metal install path pointed at it for years, and the product was sunset on 30 June 2026. I rebuilt that path on Latitude.sh with the Terraform module in [harvester-latitudesh](https://github.com/belgaied2/harvester-latitudesh), ran it four times over two days, and wrote down what broke each time. The companion post, [Latitude.sh after Equinix Metal](/blog/harvester/latitude-vs-metal/), covers whether it is a good replacement. This one is the how.

## What you get

The cluster in the reference run, on 2026-11-24:

| | |
|---|---|
| Nodes | 3 × `f4.metal.small`, 12 cores, 96 GiB, 2 × 960 GB NVMe |
| Harvester | v1.9.1, RKE2 v1.36.6+rke2r1 |
| etcd | 3 members, all control-plane |
| Longhorn | schedulable on all three |
| VIP failover | about 35 seconds after powering off the holder |
| Cost | $3.27/h for the nodes, $0.02/h for a router VM |

A single node is cheaper and simpler, on `m4.metal.small` at $0.81/h, and it is the right shape for a first attempt.

## How the install works

No TFTP server, no DHCP customisation, no config management. Each node gets its own iPXE script rendered by Terraform:

```
latitudesh_plan            resolve the plan name to a slug
latitudesh_server.create   node 1, iPXE with install.mode=create
terraform_data.wait        poll the VIP until node 1 answers
latitudesh_server.join[]   nodes 2..N, install.mode=join against the VIP
latitudesh_virtual_network + vlan_assignment   private network for management
terraform_data.oob[]       out-of-band serial console per node
```

The script carries the kernel, initrd and root filesystem URLs plus every installer argument, so the server needs nothing from your network except HTTPS to `releases.rancher.com`. It also carries the cluster token and the node password, which is why Terraform marks it sensitive and keeps it out of plan output.

State lives in an HCP Terraform workspace in Local execution mode: the provisioners run in your terminal where you can watch them, and only state and locking go to the cloud. State still contains the Latitude token, the cluster token and the rendered scripts, so workspace membership is access to all three.

## Pick a plan, and check stock for the site

Harvester documents 8 vCPU and 32 GiB for testing, 16 and 64 for production. `f4.metal.small` clears both at 12 cores and 96 GiB.

Beware the pricing page. `f4.metal.small` shows $0.55/h, which is the monthly commitment. On demand it billed **$1.09/h** in Amsterdam and US regions in November 2026.

Stock is per site, and a plan with three units in one region can have one in another:

```sh
TOKEN=$(security find-generic-password -s latitudesh -w)
curl -s -H "Authorization: Bearer $TOKEN" https://api.latitude.sh/plans |
  jq -r '.data[] | .attributes as $a | $a.regions[] |
    select(.locations.in_stock | index("AMS")) |
    "\($a.name)\t\(.locations.in_stock_count.AMS) in stock\t$\(.pricing.USD.hour)/h"'
```

## First boot: you have to find the NIC name yourself

The installer needs the Linux name of the management interface, and no API reports it. On these machines it turned out to be `enp1s0f1`, with the private port at `enp1s0f0`, and there is no way to know that before the machine boots.

The module handles it: leave `management_interface_name` empty and it renders the script with `harvester.install.automatic=false`. The installer comes up in its text UI, you read the name, and then you set it and apply again.

```sh
ip -br link
```

One trap cost me an hour. **The installer UI and logs run on `tty1`, not on the serial console**, even with `harvester.install.tty=ttyS0`. The out-of-band SOL session printed its banner and nothing else, while the installer was busy on the graphical console in the Latitude dashboard. Use Remote Access there for the discovery boot, not the serial console.

## The unattended run

Timings from the single-node reference run on 2026-11-23, `m4.metal.small`, Amsterdam:

| Step | Delta |
|---|---|
| Apply starts, server created | 0 |
| Apply returns after the reinstall | 7m42s |
| RKE2 node reports Ready | 10m48s |
| `https://<node-ip>` answers | 11m36s |

The three-node VLAN run on 2026-11-24:

| Step | Delta |
|---|---|
| Apply to VIP answering | ~14 minutes |
| Joins Ready, three nodes in cluster | ~20 minutes after the first |

Those numbers depend on Latitude provisioning, which is the least predictable part of the whole exercise; see the failures below.

## Networking: three shapes, one of which you want

This is where the project's design lives or dies. Read this before spending money.

### Public networking, one `/31` per server

By default each server gets a public `/31`: its own address and the gateway. Three nodes sit on three separate Layer 2 segments, and a Harvester VIP floats by ARP inside one subnet. It has nowhere to go.

The project's Elastic IP looks like the answer. It is a BGP address in a different `/24`, and Latitude refuses to move it between servers:

```
422 BGP_ELASTIC_IP_NOT_UPDATABLE
```

Latitude expects the server to announce that address over BGP. Harvester does not speak BGP for its VIP. On this shape, run a single node and reach it on its own address; accept the certificate warning.

### A public network with a routed block

A `latitudesh_public_network` is a routed `/29` or `/28` shared by servers bonded onto it. It gives all nodes one segment, so the VIP can float. It is a preview feature, available only where the region advertises `public_network`: ASH, CHI, LAX2, LON2, MIA2, SYD2, TOR, TYO3, TYO4. Amsterdam has private VLANs but not public networks.

I got a single node working this way, and the three-node attempt failed. What it taught:

- Latitude bonds both NICs with **802.3ad LACP**, not the installer's default `active-backup`, so the bond options have to be passed explicitly.
- The kernel command line is **limited to 2048 bytes**. Two SSH keys pushed mine to 2135 characters and silently dropped the trailing `harvester.os.dns_nameservers`, after which a static configuration failed with `Invalid configuration: DNS servers are required for static IP address`. One key fits.
- DHCP races the installer's default-route check. One attempt logged `No default route found` about a minute after boot, before the bond's lease arrived.
- The join nodes never finished provisioning. They sat in `deploying` for over thirty minutes with no ports answering, on two separate attempts. Node 1 always provisioned in 5 to 14 minutes.
- A `/28` cannot be released once created: `422 PUBLIC_NETWORK_NOT_RELEASABLE`, "configured on the switches", which needs a support ticket.

A `/28` is also $64/month on top of the servers.

### A private VLAN with a router VM, which is what worked

This is the design in the repo now, verified end to end in Dallas on 2026-11-24.

```
private VLAN 2123, 10.10.0.0/24
  harvester-router   vm-micro, public port + 10.10.0.2
                     Tailscale subnet router for 10.10.0.0/24
                     nft masquerade to its public address
  harv-1..3          f4.metal.small, standard public /31 for the live installer
                     management on enp1s0f0, VLAN 2123, 10.10.0.11-13
                     default route via 10.10.0.2
  VIP                10.10.0.100
```

The VLAN gives every node one Layer 2 segment, so the VIP floats by ARP. The router does two jobs: it advertises the subnet into the tailnet, so you reach the cluster from anywhere, and it masquerades the VLAN to its public address, so the nodes have egress.

The installer arguments that matter:

```
harvester.install.management_interface.method=static
harvester.install.management_interface.ip=10.10.0.11
harvester.install.management_interface.subnet_mask=255.255.255.0
harvester.install.management_interface.gateway=10.10.0.2
harvester.install.management_interface.interfaces=name:enp1s0f0
harvester.install.management_interface.vlan_id=2123
harvester.install.vip=10.10.0.100
harvester.install.vip_mode=static
```

`enp1s0f0` is the private port; `enp1s0f1` carries the public address the live installer uses to fetch its artifacts. The installer builds `mgmt-br.2123` on top of the private port.

One timing detail that matters: **the VLAN tag has to exist on the switch port before the installer configures the interface**. Terraform creates the assignment right after the server, and the installer starts a few minutes later, so the module puts a `sleep 300` at the top of the iPXE script. Without it the install fails at the network step.

Cost: $0.02/h for the router, on top of $3.27/h for the nodes. No `/28` fee.

## The firmware trap

Harvester 1.8 made UEFI mandatory for new PXE installs, and v1.9 enforces it before it reads any configuration. If `/sys/firmware/efi` is missing you get:

```
Legacy BIOS systems are no longer supported. Please reconfigure the system to use UEFI prior to installation.
```

`harvester.install.skipchecks=true` does not bypass this. It silences CPU, memory and disk warnings only. The fix is to watch the first boot on the console, reboot into firmware setup, set UEFI, disable CSM, and reinstall. Hardware with no UEFI option cannot run Harvester 1.8 or later; pin v1.7.x for those machines.

UEFI is confirmed on `m4.metal.small` and `f4.metal.small` in the sites I used.

## The record, and what it costs

All four runs are in the repository, with timestamps, error strings and costs: `docs/RUN-2026-11-23.md`, `RUN-2026-11-24-HA.md`, `RUN-2026-11-24-VLAN.md`.

```sh
terraform destroy
```

Then confirm the project shows zero servers in the dashboard. A forgotten three-node cluster is $78 a day. If you created a public network, the destroy will not release it, so open a support ticket the same day.

The single-node run cost about $1.30 of wall clock. The HA run was about $5 for an hour and a half, plus a `/28` that kept billing until support released it.

## What I did not do

The VLAN cluster reached three Ready nodes with a working VIP and egress, and I stopped there. Fleet's migration job failed during a Helm upgrade on that run, leaving one pod in `Error`; Harvester itself was healthy, and I have not investigated it. I have not run five or seven nodes, and I have not left a cluster up long enough to test upgrades. Treat the module as a validated way to get a lab cluster, not as a production deployment.
