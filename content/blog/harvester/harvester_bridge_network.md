---
title: Harvester VM with Bridged Network
date: 2021-03-29T20:48:37.837Z
#publishDate: 2021-04-01T00:00:00.000Z
draft: true
comments: true
tags:
    - Harvester
    - Virtualization
keywords:
    - Harvester
    - Rancher
    - Virtualization
    - Open-Source
path: /blog/harvester
categories:
    - Harvester
---

In the first article of this blog, I focused on installing Harvester and creating my first VM. In this article, I will describe how to create a VM that I can connect to directly through SSH. Indeed, the default networking mode used by Harvester is the *masquerade* mode, where the VMs get a cluster IP address, but cannot be accessed directly from outside the Harvester Cluster. In order to access the VMs from outside the cluster, you would need to create a [NodePort](https://kubernetes.io/docs/concepts/services-networking/service/#nodeport) service or a [LoadBalancer](https://kubernetes.io/docs/concepts/services-networking/service/#loadbalancer) service on the Kubernetes cluster underlying Harvester.

## Setting up the network interface for the bridged network
I need first to set up the Host's interface on which bridged networking should happen. I can do that by going to the *advanced/settings* where I will find the *network-setting*:

![Network Settings before](/hv_bridge_networking_images/hv_bridge_networking_01_settings.png)

Now, by clicking on **⋮ > Edit as a From** in front of *network-setting*, I can define the network interface that will be used on the Host to bridge the VMs Networking.

![Network Settings Edit](/hv_bridge_networking_images/hv_bridge_networking_02_settings_before.png)

In my case, I will be using the *eth4* interface:

![Network Settings new interface](/hv_bridge_networking_images/hv_bridge_networking_03_settings_network_eth4.png)

After saving, the following screen shows the new *network-setting* value:

![Network Settings after](/hv_bridge_networking_images/hv_bridge_networking_04_settings_after.png)

Now is time to setup the vlan for that bridge network.

## Settings up the vlan network

On the menu on the left side, I click on *networks* to see the following screen where I will create a new network by clicking on the *Create* button on the upper-right side.

![Network Settings after](/hv_bridge_networking_images/hv_bridge_networking_05_networks_before.png)

In the next screen, I give my network a name and a vlan number, in my case `91` , then click on *Save*:

![Network Settings set vlan](/hv_bridge_networking_images/hv_bridge_networking_06_networks_set_vlan.png)

Finally, I check the result :

![Network Settings after](/hv_bridge_networking_images/hv_bridge_networking_07_networks_after.png)

Now, we are ready to create a VM with bridged networking
## Setting up the VM for bridged networking

```
#cloud-config
password: password
chpasswd: { expire: False}
ssh_pwauth: True
packages:
  - qemu-guest-agent
```

```
version: 2
renderer: networkd
ethernets:
  enp1s0:
    dhcp4: true
  enp2s0:
    dhcp4: true

```


## Connecting to the VM

