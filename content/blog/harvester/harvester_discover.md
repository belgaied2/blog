---
title: "Discovering HCI Project Harvester"
date: 2021-03-17T13:07:15+01:00
image: "/harv_screenshots/Harvester_install1_Grub.png"
draft: true
---


# Introduction to Harvester
Harvester is an OSS (Open Source Software) project created by Rancher Labs (now part of SUSE) that provides a Kubernetes-based HCI (Hyper-Converged Infrastructure) solution. Its main goal is to combine many existing OSS projects to offer an easy-to-use platform for software defined infrastructure. This includes :

- Compute Virtualization using [KubeVirt](https://kubevirt.io/)
- Software Defined Block Storage using [Longhorn](https://longhorn.io)
- Software Defined Networking using [Multus](https://github.com/k8snetworkplumbingwg/multus-cni)
- Snapshotting and Templates using [MinIO](https://min.io/)

The objective of Harvester is to use the same platform for both containerized workloads as well as more traditional VM-based workloads, and still make the latter able to use Kubernetes features like load balancing, service discovery, etc.

# Harvester features

The main features of Harvester include but are not limited to:
- Store OS images and VM templates
- Automatic backups of VMs
- Bridge Networking and Cluster Networking for VMs
- Management of SSH Public keys
- Clustering of virtualization hosts
- Linux and Windows guests
- Console Access from the browser
- VNC console for guests
- etc.

# How to try Harvester

## Downloading Harvester

In order to try out Harvest, you will first need to download the ISO file of the latest release from [Harvester's Github page](https://github.com/rancher/harvester).

As of writing this blog, the latest version is [v0.1.0](https://github.com/rancher/harvester/releases/tag/v0.1.0).

You will need to download the file `harvester-amd64.iso`.

## Installing Harvester

Depending on where you would like to install Harvester, you might have different approaches. For instance, if you would like to deploy Harvester on Equinix Metal, you will need the iPXE installation. In this article, I will only describe the installation using the ISO on a Bare Metal server, or any machine. I do it on my Intel NUC. That means, I use a tool such as [Rufus](https://rufus.ie/en_IE.html) to create a USB drive from the ISO. Now, I can plug my USB drive to my NUC and get going with the installation.

After powering up the server with the USB drive inserted, the GRUB menu for installing Harvester should appear:

![Grub Install Harvester](/harv_screenshots/Harvester_install1_Grub.png)

Type `Enter` to continue. After that, a menu should appear to choose between creating a new Harvester Cluster or joining an existing one.

![First Step - Create New Cluster](/harv_screenshots/Harvester_Install2_createNewCluster.png)

Indeed, Harvester is an HCI solution can deploy across a cluster of machines. In order to do so, the first machine on which you install Harvester will create the cluster, and the following ones will join the cluster. In this case, we will create a single-machine Harvester cluster, so we will choose `Create a new Harvester cluster`, then type `Enter`.

The next screen is about choosing the Hard Drive that will be used for the installation.

![Choose your main Hard Drive](/harv_screenshots/Harvester_Install3_chooseDisk.png)

In this case, we choose sda. Then, you need to type a *token*. A *token* is a character string made up of letters, digits and symbols that can be used to add new nodes to the Harvester cluster. The token is first defined on the master node, nodes that need to join the cluster will need to have the master's url and the *token*. You can choose whatever token you would like on the master, but I recommend you choose a complex and unique one, to avoid having machines joining your Harvester master by mistake.

![Insert a token](/harv_screenshots/Harvester_Install4_token.png)

After inserting the token, you need to define a password for your *root* user on the Harvester node's OS. Indeed, Harvester is based on [K3OS](https://k3os.io/) which is a lightweight Linux distribution including  [K3s](https://k3s.io/), the lightweight Kubernetes distribution. 

![Set up first password for root user](/harv_screenshots/Harvester_Install5_Password.png)

This password can be used when connecting directly to the node without private key. However, the next step, will define an SSH public key to be used for remote SSH access. The public key can automatically be provided using a URL, like the ones available for Github profiles. Let's say you have a Github user named *someone*, for whom you added a public key [here](https://github.com/settings/keys). Github will make these public keys available using the url `https://github.com/someone.keys`.

![Set up SSH Public Key for rancher user](/harv_screenshots/Harvester_Install6_HostPublicKey.png)

Now, you will tell Harvester which network interface will be used as a Management Network, since many machine might have multiple network interfaces. The management network is the network that will be used to advertise Harvester's endpoint, or the URL to which you will connect to Harvester.

![Choosing the Management Network interface](/harv_screenshots/Harvester_Install7_NetworkInterface.png)

The next screen will suggest you to insert proxy information, please go ahead and give any necessary proxy information to access the internet from this machine. Internet access can be used to download VM or ISO images inside of Harvester, as well as upgrades, etc. In my case, there is no proxy to configure, that's why I will leave it blank.

![Choosing the Management Network interface](/harv_screenshots/Harvester_Install8_Proxy.png)

The next step will give you the possibility to customize your installation using [Cloud-Init](https://cloudinit.readthedocs.io/en/latest/). You just need to give a URL to a cloud-init config yaml file when asked.

![Cloud-init configuration](/harv_screenshots/Harvester_Install9_CloudInit.png)

Formatting the disk comes next with the following screen.

![Format the disk](/harv_screenshots/Harvester_Install10_FormatDisk.png)

Now finally, Harvester installation will begin.

![Installing...](/harv_screenshots/Harvester_Install11_Installing.png)

Now, after the installation is finished, the server will reboot and start harvester, first by showing GRUB:

![First Start, Grub...](/harv_screenshots/Harvester_Start1_Grub.png)

then, after everything is started, you will see the following screen:

![First Start, Running...](/harv_screenshots/Harvester_Start2_DONE.png)

At this point, you can note down the address at which you can access Harvester, and leave the machine as headless and switch to another one to access Harvester's UI. If something is wrong with remote access or the UI, you can always come back to this machine, connect a keyboard and type `F12` and then put the password for the `root` user that you setup during installation. You will then have a command prompt.

![Harvester shell](/harv_screenshots/Harvester_Start3_Shell.png)

## Using Harvester's UI

Once Harvester is up and running, you should have noted down the URL to connect to it. In the release v0.1.0, the address should use the port `8443`. In my case the address is `https://192.168.0.104:8443`. Let's connect to that address:

![Harvester Login](/harv_screenshots/Harvester_UI1_LOGIN.png)

The administrator user is `admin` and the default password is `password`, but this can be changed after the first login. Let's put the username and password and click on the `SIGN IN` button. Now the Harvester Dashboard is shown as follows:

![Harvester Dashboard](/harv_screenshots/Harvester_UI2_Dashboard.png)

The Harvester Dashboard might look similar to the Cluster Explorer in Rancher v2.5. On the left menu, you can see `Hosts`, `Virtual Machines`, `Volumes`, `Images` and `Advanced`.
- *Hosts*: This will show you the Hosts on your Harvester Cluster. Right now, you should see only one host, which is the master of your single-node cluster.
- *Virtual Machines*: This is the place where you will create new VMs on Harvester. Right now, it is empty.
- *Volumes*: These are the storage volumes that will be used by the VMs
- *Images*: These will be the ISO and Cloud image files for the OSes to be used by your VMs.
- *Advanced*: This menu will show some sub menu items to configure things like VM Templates, Bridge Networks, SSH Keys to use with your VMS, Users, and Settings. 

## Pre-requisites for creating first VM
In order to create your first VM, you need to first create an OS image under the *Images* menu. In the *Images* view, click on the *Create* button.

![Harvester Images Empty](/harv_screenshots/Harvester_UI3_Images.png)

Then, put a cloud image or ISO of your choice for the OS. In my case, I am using Ubuntu Bionic Minimal Cloud Image available [here](https://cloud-images.ubuntu.com/minimal/releases/bionic/release/ubuntu-18.04-minimal-cloudimg-amd64.img). 

![Harvester Images Ubuntu Bionic](/harv_screenshots/Harvester_UI4_ImagesUbuntuURL.png)

then click on *Create*. This will download the image and store it in Harvester's Image Store for further use. After a few seconds, you should see the following screen with an image state *Imported* in green.

![Harvester Images Ubuntu Imported](/harv_screenshots/Harvester_UI5_ImagesUbuntuImported.png)

Now, let's import the SSH public key for SSH access to the VMs by clicking on the *SSH Keys* sub-menu in the *Advanced* main menu.

![Harvester SSH Empty](/harv_screenshots/Harvester_UI6_SSHEmpty.png)

Click on *Create* then paste your public key in *SSH Key* field and give it a name in the *Name* field, then click on *Create*.

![Harvester SSH Key](/harv_screenshots/Harvester_UI7_SSHPublicKey.png)

After the create is successfully created, you should see a screen showing it with the State *Validated* on left hand side as the following.

![Harvester SSH Key Validated](/harv_screenshots/Harvester_UI8_SSHKeyValidated.png)

Now, we are ready for creating a VM.

## Creating the first VM

Now, in order to actually create the VM we will click on the *Virtual Machines* menu to see the following view.

![Harvester VM Menu empty](/harv_screenshots/Harvester_UI9_VMEmpty.png)

Then, click on *Create* to open the VM creation wizard. In the *Name* field give a VM name, you can add a description in the *Description* field. Add the required CPU number in the *CPU* field and required memory size in GiB in the *Memory* field, and choose the OS Image in the *Image* field as well as the SSH Key in the *SSHKey* field.

![Harvester VM Basics](/harv_screenshots/Harvester_UI10_VMBasics.png)

In this wizard's *Volumes* sub-menu you can choose to add an additional Disk volume to your VM.

![Harvester VM Storage](/harv_screenshots/Harvester_UI11_VMStorage.png)

In the *Networks* sub-menu, you can override the network settings, for example to setup a bridge network, we will NOT do this here.

![Harvester VM Network](/harv_screenshots/Harvester_UI12_VMNetwork.png)

You also add some cloud-init configuration if you wish under the *Advanced Options* sub-menu.

![Harvester VM Advanced](/harv_screenshots/Harvester_UI13_VMAdvanced.png)

After clicking on *Create* and waiting for a couple of minutes, you should see the following screen.

![Harvester VM Running](/harv_screenshots/Harvester_UI14_VMRunning.png)

Harvester shows the VM as being in the `Running` state in green, and offers the possibility to connect to use using a serial console by clicking on the arrow near the *Console* button and then on *Open in Serial Console*.

![Harvester VM Console Menu](/harv_screenshots/Harvester_UI15_VMConsoleMenu.png)

Now, a command prompt should opne with a login prompt, this a serial access to the VM, this does not work with your private key, so you need to have set a password in cloud-init or your Cloud image.

![Harvester VM Serial Console](/harv_screenshots/Harvester_UI16_VMSerialConsole.png)

Congratulations! You now have created a VM in your new Harvester Installation, and you were able to access the VM from the browser.

## Conclusion
Though this article seems long because of the screenshots, you see that the installation of Harvester is pretty straightforward and that the creation of a new VM is possible after a couple of minutes. You also see that there is no need to have any understanding of Kubernetes or how Kubernetes works to install and use Harvester. 
This first article only scratches the surface of what is possible to do using Harvester. I will try to deep dive into more Harvester topics in the futures. If you have any questions, please post them in the comments sections. I will be more than happy to answer them.

