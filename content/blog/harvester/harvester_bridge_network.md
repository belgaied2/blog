---
title: Harvester VM with Bridged Network
date: 2021-03-29T20:48:37.837Z
publishDate: 2021-04-01T00:00:00.000Z
draft: false
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

## Settings up the vlan network

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
network:
  version: 2
  ethernets:
    enp1s0:
      dhcp4: true
    enp2s0:
      dhcp4: true

```


## Connecting to the VM

