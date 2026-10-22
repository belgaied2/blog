---
title: "Harvester HCI: what it is and how to install it"
description: "Harvester is SUSE's open source HCI platform built on Kubernetes, KubeVirt and Longhorn. What it is, when it fits, the hardware it needs, and a hands-on install."
summary: "What Harvester is, the hardware it needs in v1.9, when it fits and when it does not, and a walkthrough of the install."
date: 2021-03-17T13:07:15+01:00
lastmod: 2026-10-22T15:30:00+02:00
image: "/harv_screenshots/Harvester_install1_Grub.png"
draft: false
comments: true
tags:
    - Harvester
    - Virtualization
keywords:
    - Harvester
    - Harvester HCI
    - Rancher
    - Kubernetes
    - Virtualization
    - Open-Source
---

Harvester is an open source hyper-converged infrastructure (HCI) platform from SUSE. It runs virtual machines on Kubernetes, so the same cluster that hosts containers can also host Windows and Linux VMs, and those VMs get Kubernetes primitives like load balancing and service discovery instead of living in a separate silo.

This article started as an install walkthrough in 2021, when Harvester was at v0.1.0. It is now updated for **v1.9** (released September 2026). The install screenshots are still from that first release: the flow is the same, but the interface has changed, so treat them as a guide to the steps rather than to the current UI. For pixel-accurate screens, use the [official installation guide](https://docs.harvesterhci.io/v1.9/install/index).

## What Harvester actually is

Harvester is not a hypervisor written from scratch. It is an opinionated bundle of existing projects, assembled into an appliance you install from an ISO. Under the hood:

- **KubeVirt** runs the virtual machines as Kubernetes workloads, so a VM is a custom resource, not a process on a hypervisor.
- **Longhorn** provides replicated block storage across the nodes. This is where VM disks live.
- **Multus** gives each VM one or more network interfaces, including bridged interfaces on your physical network.
- **Canal** (Calico + Flannel) handles the cluster network, with **Kube-OVN** available as an experimental overlay.
- **RKE2** is the Kubernetes distribution, running on a **SUSE Linux Micro** base rather than the K3OS the early releases used.

That lineage matters in practice. Troubleshooting often means looking at Kubernetes objects rather than at a hypervisor console, and capacity planning means thinking about Longhorn replicas rather than about RAID groups.

## What you get out of the box

- VM lifecycle management through a web UI: create, clone, snapshot, live migrate.
- An image store for cloud images and ISOs, with automatic download and import.
- VM templates and SSH key management.
- Backups and snapshots backed by Longhorn, including VM snapshot and restore.
- Bridged and cluster networking, with VLAN support.
- A browser VNC and serial console for every VM.
- Live migration when hosts enter maintenance mode.
- Rancher integration, so Harvester can act as the infrastructure provider for downstream clusters.
- A Terraform provider and a full API, for everything the UI can do.

## When Harvester is a good fit

It fits when three things are true at once:

1. You already run Kubernetes, or you want to. Harvester's value is partly in the integration: VMs become another workload class, and Rancher can provision clusters onto them through Cluster API.
2. You have modern hardware. The requirements below are not gentle, and Harvester does not run on laptops or nested virtualization.
3. You want to consolidate VMs and containers on the same pool of hosts without buying a separate hypervisor licence.

## When it is not

- **A handful of small VMs on one host.** Proxmox or plain KVM will do it with a fraction of the resources.
- **A mixed estate you inherited.** If the VMs are Windows domain controllers with vendor appliances and 15-year-old OS images, a traditional hypervisor will ask fewer questions.
- **Anything without enterprise SSDs.** Longhorn wants 5,000+ random IOPS per disk. Spinning rust is not an option.
- **Laptops, nested virtualization, or a lab inside a VM.** Explicitly unsupported.

## Hardware requirements

These are the v1.9 minimums. The right-hand column is the recommendation for production.

| | Minimum | Recommended |
|---|---|---|
| CPU | 8 cores, x86_64 or ARM64 with hardware virtualization | 16 cores |
| Memory | 32 GB per node | 64 GB |
| Disk | 250 GB per node, SSD/NVMe, 5,000+ IOPS | 500 GB, 1 TB or more |
| Network | 1 Gbps | 10 Gbps |
| Nodes | 1 (no HA) | 3, for a high availability management cluster |

A few details that catch people out:

- **Three nodes is the real minimum** if you want the multi-node features: HA management, replicas, live migration. A single-node cluster works but gives up all of that.
- **Local disks and hardware RAID only.** No SAN LUNs presented to the nodes.
- **UEFI only for new installs.** Legacy BIOS booting was deprecated in v1.7 and new installations have been UEFI-only since v1.8. Older clusters still booting legacy will need a reinstall to move forward eventually.
- **Identical CPU models** across nodes, or live migration will refuse to move VMs between them.

## How it compares

Short version, from an operational standpoint rather than a benchmark one:

| | Harvester | Proxmox VE | vSphere |
|---|---|---|---|
| Licence | Apache 2.0 | AGPL core, paid support | Commercial |
| Control plane | Kubernetes | Custom | Custom |
| Storage | Longhorn, distributed | ZFS, Ceph | VMFS, vSAN |
| Minimum per node | 8 cores / 32 GB | much lower | much lower |
| Fits a homelab | only a well-specced one | yes | rarely |
| Fits a Kubernetes shop | very well | workable | with extra tooling |

Harvester's bet is that Kubernetes-native infrastructure is worth the resource overhead. If that bet is not yours, the alternatives are cheaper to run.

## Installing Harvester

### 1. Get the ISO

Download the ISO for the current release from the [Harvester releases page](https://github.com/harvester/harvester/releases). As of writing that is v1.9.0, and the file is named `harvester-v1.9.0-amd64.iso`. ARM64 builds exist as well.

Write it to a USB stick with Rufus, balenaEtcher or `dd`, or present it as virtual media if your hardware supports it. There is also a PXE/iPXE path for larger deployments, which is what you would use on Equinix Metal or in a datacenter.

### 2. Boot the installer

Boot the machine in UEFI mode. You should get the GRUB menu:

![Harvester installer GRUB menu](/harv_screenshots/Harvester_install1_Grub.png)

The next screen asks whether you are creating a new cluster or joining an existing one. The first node creates the cluster; every additional node joins it using the same token.

![Create a new cluster or join an existing one](/harv_screenshots/Harvester_Install2_createNewCluster.png)

For a multi-node deployment this is also where you set the **management address**, a virtual IP that the cluster keeps and that you will use to reach the UI. That step did not exist in the earliest releases.

### 3. Pick the disk, the token, and the credentials

Choose the disk Harvester will take over. It will be wiped, so make sure it is the right one.

![Selecting the installation disk](/harv_screenshots/Harvester_Install3_chooseDisk.png)

Then set the cluster token. Every node that joins must present the same token, so make it long and random; a short one is an invitation for a stray machine to join your cluster.

![Setting the cluster token](/harv_screenshots/Harvester_Install4_token.png)

Set the `root` password for the host OS, and provide an SSH public key for remote access. The key can be fetched from a URL, which is handy if you keep it on GitHub at `https://github.com/<user>.keys`.

![Setting the root password](/harv_screenshots/Harvester_Install5_Password.png)

![Setting the SSH public key](/harv_screenshots/Harvester_Install6_HostPublicKey.png)

### 4. Network, proxy, cloud-init

Choose the interface that will carry the management network. If you have two NICs, use a bond; a single NIC works for testing but gives you no redundancy.

![Choosing the management interface](/harv_screenshots/Harvester_Install7_NetworkInterface.png)

If the host needs a proxy to reach the internet, set it here. The cluster uses it for image downloads and upgrades.

![Proxy configuration](/harv_screenshots/Harvester_Install8_Proxy.png)

Finally, you can supply a [cloud-init](https://cloudinit.readthedocs.io/) file by URL to customise the host on first boot: users, SSH keys, packages, kernel parameters.

![Cloud-init configuration](/harv_screenshots/Harvester_Install9_CloudInit.png)

### 5. Confirm and wait

The last screen warns you that the disk will be formatted. After confirming, the installer copies the system and reboots.

![Formatting the disk](/harv_screenshots/Harvester_Install10_FormatDisk.png)

![Installation in progress](/harv_screenshots/Harvester_Install11_Installing.png)

When the machine comes back, it boots into the installed system:

![First boot, GRUB](/harv_screenshots/Harvester_Start1_Grub.png)

![Harvester running on the console](/harv_screenshots/Harvester_Start2_DONE.png)

The console screen shows the management URL. You can now leave the machine headless. If you ever need a shell on the host, press `F12` at the console and log in as `root` with the password you set.

![Harvester host shell](/harv_screenshots/Harvester_Start3_Shell.png)

## Using the UI and creating a first VM

Open the management URL in a browser. Current releases serve the UI on port 443; older ones used 8443, which is why older tutorials mention it.

![Harvester login](/harv_screenshots/Harvester_UI1_LOGIN.png)

The default administrator is `admin` with password `password`, and the UI forces you to change it on first login. Change it before you do anything else.

![Harvester dashboard](/harv_screenshots/Harvester_UI2_Dashboard.png)

The left menu covers the objects you will live in: **Hosts**, **Virtual Machines**, **Volumes**, **Images**, and **Advanced** (templates, networks, SSH keys, users, settings).

To create a VM you need two things first: an image and an SSH key.

### Add an image

Go to **Images → Create** and give Harvester a cloud image or ISO URL. A minimal Ubuntu cloud image is a good first test, because it boots quickly and accepts cloud-init.

![Images view, empty](/harv_screenshots/Harvester_UI3_Images.png)

![Adding an Ubuntu cloud image](/harv_screenshots/Harvester_UI4_ImagesUbuntuURL.png)

Harvester downloads the image and stores it. Wait for the state to go green.

![Image imported](/harv_screenshots/Harvester_UI5_ImagesUbuntuImported.png)

### Add an SSH key

Under **Advanced → SSH Keys**, paste the public half of the key you want to use for VM access.

![SSH keys view, empty](/harv_screenshots/Harvester_UI6_SSHEmpty.png)

![Adding a public key](/harv_screenshots/Harvester_UI7_SSHPublicKey.png)

![Key validated](/harv_screenshots/Harvester_UI8_SSHKeyValidated.png)

### Create the VM

**Virtual Machines → Create** opens the wizard. Set the name, CPU, memory, the image you just imported, and the SSH key.

![Virtual machines view, empty](/harv_screenshots/Harvester_UI9_VMEmpty.png)

![VM basics](/harv_screenshots/Harvester_UI10_VMBasics.png)

The **Volumes** tab is where you add extra disks. The **Networks** tab is where you change networking; by default the VM sits on the cluster network with masquerading, so it can reach out but cannot be reached directly. If you need an address on your LAN, use a bridged network instead.

![VM volumes](/harv_screenshots/Harvester_UI11_VMStorage.png)

![VM networks](/harv_screenshots/Harvester_UI12_VMNetwork.png)

**Advanced Options** carries the cloud-init user data, which is how you inject a login user or a password into a cloud image with no default credentials.

![VM advanced options](/harv_screenshots/Harvester_UI13_VMAdvanced.png)

After a couple of minutes the VM should be `Running`.

![VM running](/harv_screenshots/Harvester_UI14_VMRunning.png)

Open the console from the **Console** dropdown. The serial console does not use SSH keys, so you need a password set through cloud-init or baked into the image.

![Console menu](/harv_screenshots/Harvester_UI15_VMConsoleMenu.png)

![Serial console](/harv_screenshots/Harvester_UI16_VMSerialConsole.png)

That is the whole loop: image, key, VM, console. Everything after this is the same pattern on a larger scale.

## Day two

The parts that matter after the first VM:

- **Upgrades** are managed by the platform, one node at a time, with VMs live-migrated off the node being upgraded. Check the free space on the system partition before starting; Longhorn fills it quietly.
- **Rancher integration** registers Harvester as a cluster in Rancher, after which you can create downstream RKE2 and K3s clusters on Harvester VMs.
- **Cluster API** goes further: with [Rancher Turtles](/blog/harvester/rancher_turtles_with_harvester/) you declare clusters as Kubernetes objects and let a controller provision them, instead of clicking through Rancher.
- **Backups** are Longhorn snapshots and backups. Point them at an S3-compatible target, not at the same disks you are protecting.

## FAQ

### Is Harvester free?

The project is Apache 2.0. SUSE sells a supported edition and support contracts around it. There is no per-core or per-socket licence.

### Do I need to know Kubernetes to use it?

To install it and run VMs through the UI, no. To operate it, yes, at least a working knowledge: you will read pod logs, check Longhorn volumes, and understand what a CRD is. The claim that Harvester hides Kubernetes entirely is only true on day one.

### Can I run it on a single node?

Yes, single-node clusters are supported. You lose HA, replicas and live migration, which is most of the reason to run HCI in the first place. It is a reasonable way to evaluate the platform.

### Can I run it on a laptop or inside a VM?

No. Laptops and nested virtualization are explicitly unsupported, and both the CPU and disk requirements rule it out in practice.

### How much does a usable cluster cost in hardware?

Three nodes at 8 cores, 32 GB and 500 GB of SSD each, plus 10 Gbps networking if you want the recommended configuration. That is the real entry ticket.

### Harvester or Rancher?

Rancher manages Kubernetes clusters. Harvester is one place those clusters can run, and it can be managed by Rancher. They are complementary, not alternatives.

## Conclusion

Harvester's pitch is coherence: one platform, one API, VMs and containers side by side, managed the Kubernetes way. The price is hardware and a learning curve, and the payoff is that your virtualization layer speaks the same language as everything else in the stack.

If you are starting from zero on a single machine, this is overkill. If you are running Rancher at work and want the same model on your own metal, it is the most direct path.

## Related posts

- [Harvester networking: attaching a VM to a bridged network](/blog/harvester/harvester_bridge_network/) covers the networking step this article skips: giving a VM an address on your LAN.
- [Rancher Turtles with Harvester](/blog/harvester/rancher_turtles_with_harvester/) shows how to provision downstream Kubernetes clusters on the VMs you just created.
