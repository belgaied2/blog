---
title: "LLMs on homelab Kubernetes: llm-d, vLLM, HAMi and Kaito"
description: "GPU sharing, vLLM and cache-aware routing on hardware you own, and how much of the production AI inference stack you can learn at home."
summary: "GPU sharing, vLLM and cache-aware routing on hardware you own, and how much of the production AI inference stack you can learn at home."
date: 2026-10-23T10:00:00+02:00
tags:
  - Kubernetes
  - AI
  - Homelab
  - HAMi
  - Kaito
  - llm-d
  - vLLM
keywords:
  - Kubernetes
  - LLM
  - Homelab
  - HAMi
  - Kaito
  - llm-d
  - vLLM
  - GPU sharing
---

Five years ago Dan Garfield gave a talk called *The Quest for the Ultimate Kubernetes Homelab*, and the line that stuck was that the cluster in your closet isn't a toy: it's where you learn what you do later at work. Mine runs the photo library, the password manager, the CRM and the document archive. In October 2026 I gave a talk at **KCD Edinburgh** asking whether it can also run a *useful* LLM, with the same stack an enterprise would use.

Short answer: yes, and you probably shouldn't, unless learning is the point. The measurements below are from the week before the talk.

## Three cards, none of them datacenter

The demo cluster was k3s with Cilium on a mini-PC control plane, with two cards at home and one rented:

| GPU | VRAM | What it runs |
|---|---|---|
| GTX 1080 Ti (2017, Pascal) | 11 GB | llama.cpp CUDA in HAMi slices. **No vLLM**: compute capability 6.1, it needs ≥ 7.0 |
| RX 6900 XT (2020, RDNA2) | 16 GB | llama.cpp on Vulkan. No HAMi, no Kaito, no vLLM |
| RTX 3090 (rented on vast.ai) | 24 GB | vLLM through Kaito, behind llm-d |

The 3090 is the interesting one: **$0.35–0.46 an hour on vast.ai**, joined to the LAN over a WireGuard split tunnel, roughly 130 ms from the control plane. That is not a detail, it is the whole argument for "ephemeral inference" — and later in this post it is also the reason a demo broke.

## What it is actually for

Inference you can point at is worth more than a benchmark. The cluster serves:

- **Paperless-ngx**: OCR, tagging and summarising scanned documents.
- **Twenty CRM**: enriching and summarising contacts.
- **Open WebUI**: the family chat window.
- **Meeting transcripts**: recorded on a phone, transcribed locally.
- **Home Assistant**: local voice, Whisper → small LLM → Piper.
- **Agents**: anything that would otherwise call a paid API.

Privacy is the honest motivation: documents, photos and family conversations never leave the network. Offline is the second. But local covers the boring 80%, not the hard 20%: a small model greeted the audience with *"Hello, KCD Edinburgh — your Graph Partitioning Enthusiasts' meeting spot since 1993!"*

## HAMi: GPU sharing, four workloads on one 11 GB card

This is the part worth doing even if you skip everything else. HAMi slices GPU memory between pods. On the 1080 Ti, four services ran at once:

| Pod | Model | Slice | Used |
|---|---|---|---|
| chat | Gemma 4 E4B | 6800 MiB | 3400 MiB |
| embeddings | nomic-embed-text v1.5 Q8_0 | 1500 MiB | 290 MiB |
| speech-to-text | Whisper large-v3-turbo (int8) | 1500 MiB | 944 MiB |
| OCR | Granite-Docling-258M Q8_0 | 1200 MiB | 638 MiB |

Four workloads on one card, 11,000 of 11,264 MiB allocated, and the card sits at about 4.4 GB when idle. A 1080 Ti that would otherwise be idle most of the day becomes four services.

Performance is fine. **~60 tok/s** for Gemma 4 E4B in a 6.8 GB slice, **94.6 tok/s** for Llama 3.2 3B in 5 GB. Whisper large-v3-turbo transcribes 11 seconds of audio in **0.96 s** warm, 6.8 s on the first call while the model loads. The OCR pass gets a synthetic invoice 100% right, table included, in 6.5 s cold and 1.7 s warm.

The isolation is real, and you can prove it from inside a pod:

```
$ kubectl exec chat -- nvidia-smi
memory.total: 5000 MiB        # the card is 11264
$ # loading a second model in the same pod:
[HAMI-core ERROR] Device 0 OOM 5312842368 / 5242880000
```

Refused at the slice boundary while the card still had ~7 GB free. That is the feature working, but it surprises people who expect the scheduler to be clever.

Two limits matter. It is **memory isolation, not performance isolation**: a busy pod slows its neighbours. And **anything on the GPU outside Kubernetes is invisible to HAMi** — Open WebUI, running in Docker on the same machine, quietly held 242 MiB for its built-in embeddings until I pointed it at the cluster's service.

## The RX 6900 XT: the fastest card that supports nothing

The RX 6900 XT has no HAMi, no Kaito, no vLLM. It is a plain Deployment running llama.cpp on Vulkan, and it is **the fastest card in the cluster**: on the same Llama 3.2 3B, **177.7 tok/s against the 1080 Ti's 99.0**.

Kubernetes still schedules it. You just don't get slicing or smart routing. If you have a consumer AMD card, stop reading the rest of this post and install llama.cpp.

Where it gets interesting is MoE models with RAM offload. Qwen3.6-35B-A3B (21 GiB at Q4) runs on 16 GB of VRAM plus system RAM:

| Setting | Generation |
|---|---|
| `--n-cpu-moe 14` (14 layers of experts in RAM) | **45.3 tok/s** |
| `--n-cpu-moe 10` (more on GPU) | **22.3 tok/s** |
| `--n-cpu-moe 14` + MTP speculative decoding | 25.9 tok/s |

More layers on the GPU is *slower*, because the GPU part no longer fits and the driver spills into system memory. Speculative decoding makes it worse for the same reason: verifying drafted tokens touches more experts on the CPU per step, despite 55% draft acceptance.

The KV cache matters even more. Same model, 64k context, a 60,218-token prompt:

| KV cache | Generation | Time to read the prompt | Correct answer |
|---|---|---|---|
| q8_0 | 23.8 tok/s | **761 s** | yes |
| q4_0 | 44.6 tok/s | **155 s** | yes |

Same answer, five times faster. Quantising the KV cache took reading a 60k-token document from thirteen minutes to two and a half. If long documents are your use case, do that before buying more VRAM.

## Kaito: a model as a custom resource

Kaito turns a model into a Kubernetes object. An `InferenceSet` produces vLLM pods from a preset or any Hugging Face model:

```yaml
apiVersion: kaito.sh/v1alpha1
kind: InferenceSet
metadata:
  name: phi-4-mini
spec:
  replicas: 1
  template:
    model:
      name: phi-4-mini
```

Throughput is the reason to bother: **223,622 tokens per minute** at 40 concurrent requests (2048 in, 256 out), average TTFT 2.6 s, 89 ms per output token, on one 3090.

Bring-your-own-node is where it gets sharp. **`featureGates.disableNodeAutoProvisioning=true` is not enough**: without `nodeProvisioner: byo`, every Workspace is rejected with `instanceType is required when node auto-provisioning is enabled`. The value is only documented in the controller source.

Three more that cost real time:

- **The chart ships its own NVIDIA device plugin and its own NFD/GFD.** Next to HAMi and the GPU Operator, two device plugins fight, and the second NFD master *wiped the GPU labels Kaito needs* to size vLLM. Disable both, then restart the GPU Operator's NFD and GFD.
- **The served model name is the InferenceSet name** (`phi-4-mini`), not the preset name. Requests to the preset name return 404.
- **Kaito asks for whole GPUs** (`nvidia.com/gpu: 1`, no memory limit), so under HAMi a Kaito pod takes the entire card. `resource.partition` is MIG-only, which consumer cards do not have.

## llm-d: routing that needs two replicas

llm-d puts a router in front of an `InferencePool`. The EPP scores replicas by queue depth, KV-cache use and prefix-cache affinity, so prompts sharing a prefix land on the replica that already cached it. Round-robin does the opposite and wastes the cache.

It works: **22 tokens in 0.40 s end to end** through the Istio gateway and the router, against 29 tokens in 0.52 s directly to the pod. The router adds no visible latency.

And the honest part: **with one replica, there is nothing to choose between.** llm-d is plumbing until you run two or more replicas of the same model, which at home needs two GPUs, or one GPU sliced by HAMi — the experiment I ran out of time for.

Two practical notes. Kaito only creates the InferencePool and router for an `InferenceSet`; a plain `Workspace` gets none. And neither Cilium's gateway nor Traefik implements the Gateway API Inference Extension, so Istio runs gateway-only next to Cilium, no sidecars.

## Cold starts: 22 minutes for an image, 28 for a model

Kubernetes is not slow. Pulling five gigabytes of weights is.

| What | Time |
|---|---|
| vLLM image (5.6 GB) | **22 min** on my line |
| Kaito replica, image cached, model to download | ~25–28 min |
| Kaito replica, image and weights warm | **~8 min** to Ready |
| Gemma 4 E4B with a Hugging Face token, warm cache | 94 s |
| llama.cpp Vulkan, model cached | 36 s |

And then the rented-GPU lesson: **destroying the vast.ai instance deletes the image and the weights with it.** The next node starts the 22 + 28 minutes again. Ephemeral inference only works if images and models are cached somewhere that outlives the GPU — a registry mirror and a model store on real disks. I learned that the expensive way, twice.

## vLLM or Ollama?

I did not benchmark Ollama on these cards, so this is an argument, not a measurement. Ollama is one binary serving one model to one user, and it is the right answer for most homelabs.

vLLM's advantage appears when requests arrive together: **223,622 tokens per minute** at 40 concurrent requests on one 3090 is a different class of throughput from a single-user server. It also exposes the queue and KV-cache metrics that llm-d needs in order to route. If you are the only user, the difference is operational. If several people or apps share the endpoint, it is the point.

## The verdict

| Your situation | Use |
|---|---|
| One GPU, one user | **Ollama or LM Studio.** Don't overthink it |
| Several AI services on one card | **HAMi.** Worth installing tonight |
| GPUs that join and leave (gaming PC, rented card) | Kubernetes — after you cache images and weights |
| Two or more replicas of the same model | **Kaito + llm-d.** Where the enterprise stack earns its keep |

My first reason is **learning**, the second is **privacy**. You will not save money and you will not run the best models. The moving parts tell the story: Ollama is one process; this stack is GPU Operator, HAMi, Kaito, Flux, Istio, llm-d and Prometheus, and each one can break the others.

The professional argument is real, though. vLLM, the Gateway API Inference Extension and llm-d are the same building blocks showing up in production platforms, and a homelab is the cheapest place to break them: *my homelab is where I broke llm-d before I had to explain it to a customer.*

## What this teaches you about production inference

The stack in this post is not a homelab toy version of something else. It is the same shape as what teams run in production: a GPU operator for device management, HAMi or MIG for sharing, vLLM for serving, the Gateway API Inference Extension for routing, and an autoscaler or model operator above it.

What changes at work is scale and consequence, not vocabulary. A replica that takes 28 minutes to become Ready is a demo problem at home and an incident in production. A device plugin that fights another one is a puzzling evening here and a failed rollout there.

That is the argument for running this at home: you meet the failure modes on hardware where the blast radius is your own weekend.

## Pitfalls: HAMi, Kaito and llm-d

- **One device plugin per GPU vendor.** HAMi replaces NVIDIA's. Disable the GPU Operator's and Kaito's, or they fight.
- **One NFD.** Two Node Feature Discovery instances cost me the GPU labels Kaito sizes vLLM from.
- **Ghost GPUs.** A card moved to another machine leaves a `NodeFeature` object behind, and NFD re-applies the old labels from it. Delete the object, not just the labels.
- **A driver upgrade without a reboot** gives `Driver/library version mismatch` and crash-looping GPU pods. It happened twice: once by hand, once by unattended upgrades on talk day. Pin the NVIDIA packages with `apt-mark hold`.
- **Rolling updates need spare VRAM.** On a fully sliced card the new pod stays `Pending` next to the old one. Use `strategy: Recreate`.
- **A "supported" CUDA image may not support your GPU.** The official whisper.cpp CUDA image skips Pascal; it fails at the first request, not at startup. Test a real request before calling a workload Ready.
- **OpenAI-compatible isn't always compatible.** Open WebUI sends `tool_choice: "auto"`, which vLLM rejects unless started with `--enable-auto-tool-choice` and a tool-call parser. Kaito does not set them.

## FAQ

### Does HAMi work with AMD GPUs?

Instinct cards only. The RX 6900 XT is not supported; it runs llama.cpp on Vulkan instead.

### Can vLLM run on a GTX 1080 Ti?

No. vLLM needs compute capability 7.0 or newer (Volta and later); Pascal is 6.1. llama.cpp CUDA works on the same card.

### How much VRAM does a 7B model need at Q4?

Roughly 0.6 GB per billion parameters for the weights, plus the KV cache. A 7B model at Q4_K_M is about 4.5 GB, so plan for 6 to 8 GB to leave room for context.

### Is Kubernetes worth it for a single GPU?

No. Ollama or LM Studio on the host gives you one moving part. Kubernetes starts paying off with several services, several GPUs, or GPUs that join and leave.

### Why does llm-d need more than one replica?

The router picks a replica per request, scoring queue depth, KV-cache use and prefix affinity. With one replica there is nothing to choose between, so it is plumbing without a payoff.

## What I did not do

No like-for-like Ollama comparison on the same GPU, so the "is Kubernetes worth it" answer is an argument, not a measurement. No two Kaito replicas on one card through HAMi, so llm-d's cache-aware routing is wired and timed but not demonstrated. And the OCR route through docling on the GPU was 1.5 s per page against 12–72 s on CPU, but tables came back empty, so Paperless still runs on CPU.

Those are the next three experiments, and the reason there will be a part two.

---

The manifests, values, scripts and every number above are in the companion repository: [homelab-cluster-llm](https://github.com/belgaied2/homelab-cluster-llm). Measurements are from 13–17 October 2026 on the hardware described, warm runs unless stated.
