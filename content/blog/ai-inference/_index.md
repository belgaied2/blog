---
title: "Kubernetes AI inference"
description: "Running LLMs on a homelab Kubernetes cluster: cache-aware routing with llm-d, vLLM serving, GPU sharing with HAMi and model lifecycle with Kaito, plus an honest answer about when any of it is worth it."
---

The homelab cluster is where a lot of us learn what we later run at work. Mine runs the photo library, the password manager, the CRM, the document archive. In October 2026 I gave a talk at KCD Edinburgh asking whether it can also run a *useful* LLM, using the same stack an enterprise would: llm-d for routing, vLLM for serving, HAMi for GPU sharing, Kaito for model lifecycle.

This is the written version, with the measurements and, more importantly, the parts that broke.
