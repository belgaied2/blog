---
title: "Latitude.sh after Equinix Metal: a Harvester verdict"
description: "Equinix Metal shut down in June 2026. After four runs installing Harvester on Latitude.sh, here is what the platform handles, what it does not, and who should care."
summary: "Equinix Metal shut down in June 2026. After four runs installing Harvester on Latitude.sh, here is what the platform handles, what it does not, and who should care."
date: 2026-11-26T10:30:00+01:00
tags:
  - Harvester
  - Latitude.sh
  - Equinix Metal
  - Bare metal
keywords:
  - Latitude.sh
  - Equinix Metal
  - Harvester
  - bare metal
  - HCI
---

Equinix Metal reached end of life on **30 June 2026**. Every server was deleted the next day, new resources stopped being creatable, and the console goes offline on 31 December 2026. For anyone who followed Harvester's bare-metal documentation, that removed the only cloud the docs ever named.

Latitude.sh is the obvious candidate to replace it, and I have now installed Harvester there four times. This is the short version: where it works, where it fights you, and whether the swap is worth making.

## What Latitude is

Hourly bare metal in 26 regions, a Terraform provider at v4.8.0, an API that covers servers, VLANs, out-of-band consoles and public networks, 20 TB of egress per server per month, and a `lsh` CLI. Nothing exotic, and nothing missing that a Harvester install needs.

## What worked

A three-node HA cluster in Dallas, on a private VLAN, with a Tailscale router VM providing access and egress:

| | |
|---|---|
| Harvester | v1.9.1, RKE2 v1.36.6 |
| Nodes | 3 × `f4.metal.small`, 12 cores, 96 GiB, 2 × 960 GB NVMe |
| Cluster | etcd 3, Longhorn on all nodes, VIP answering |
| Failover | about 35 seconds after powering off the VIP holder |
| Cost | $3.36/h including the router |

Install automation is the part I would miss most if I moved. The whole cluster comes from one `terraform apply`: servers bought, iPXE scripts rendered, installs run, VIP polled until it answers, joins started. No TFTP, no DHCP server, no image library.

UEFI is present on `m4.metal.small` and `f4.metal.small`. Harvester 1.9 refuses to install without it, so this is not a detail.

## What did not work

**Public networking cannot carry a VIP.** Each server gets a public `/31`, which puts three nodes on three separate Layer 2 segments. A VIP that floats by ARP has nowhere to float. The project Elastic IP is a BGP address in another `/24`, and moving it between servers returns `422 BGP_ELASTIC_IP_NOT_UPDATABLE`. Latitude expects BGP announcement; Harvester does not do BGP for its VIP. On standard networking, the supported shape is a single node reached on its own address.

**The routed-block workaround is half-finished.** A public network gives all nodes one segment, and a single node worked on it. The three-node attempt failed twice: join nodes sat in `deploying` for over thirty minutes with no ports answering. A `/28` also costs $64/month, cannot be released without a support ticket (`422 PUBLIC_NETWORK_NOT_RELEASABLE`), and exists only in ASH, CHI, LAX2, LON2, MIA2, SYD2, TOR, TYO3 and TYO4. Amsterdam has private VLANs and no public network at all.

**Provisioning is the least predictable part.** Node 1 always came up in 5 to 14 minutes. Parallel joins did not, on either attempt. If your automation assumes three servers provision in parallel, you will spend the evening watching status fields.

**Some facts are not in the API.** The management NIC name is not exposed. You find it by booting the installer in interactive mode and reading `ip -br link`. Nor is the disk device, which is `/dev/nvme0n1` on NVMe-only plans and `/dev/sda` elsewhere.

## Comparing to Metal, honestly

Metal's pricing and API are no longer obtainable, so I cannot run a live comparison, and repeating old price tables would be inventing evidence. The useful comparison is capability:

| Capability | Equinix Metal | Latitude.sh |
|---|---|---|
| Hourly bare metal | discontinued | yes, 26 regions |
| Custom iPXE / UEFI | yes | yes, confirmed on two plans |
| Private VLAN between nodes | yes | yes |
| Public block shared by nodes | yes | preview, 9 regions, paid, hard to release |
| Portable public VIP | via BGP, `metallb` and friends | no, Elastic IP cannot move |
| Terraform provider | archived with the product | maintained, v4.8.0 |
| Out-of-band console | yes | yes, SOL plus dashboard KVM |

The one that matters for HCI is row five. Metal's networking model suited a cluster that wants an address which follows it between nodes. Latitude's default model gives each machine its own pipe and no shared segment, which is why the validated design puts management on a private VLAN behind a router.

## The verdict

If you want to evaluate Harvester, teach it, or run a lab cluster in someone else's rack for a few hours, Latitude.sh works and costs about $13 for a four-hour three-node run. The private VLAN design is documented and reproducible.

If you need a production cluster with a public VIP that survives a node failure without a router VM you maintain yourself, Latitude gets you there and makes you build the network layer to do it. That is a fair trade for a lab and an awkward one for a platform team.

Where I would look next for the production case: colocation with your own switch fabric, OVH, or OpenMetal, all of which sell a segment rather than a `/31`. I have not tested any of them with Harvester, and I am not going to guess.

The install tutorial, with timings, kernel arguments and the four run logs, is in [Installing Harvester on Latitude.sh with Terraform and iPXE](/blog/harvester/harvester-on-latitudesh/). The module is [harvester-latitudesh](https://github.com/belgaied2/harvester-latitudesh).
