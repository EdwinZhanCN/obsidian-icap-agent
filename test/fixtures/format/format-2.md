---
tags: [cpp]
---
# RAII

Resources in C++ are tied to object lifetimes.

RAII ties a resource's lifetime to an object's lifetime.

When the object goes out of scope, its destructor releases the resource, even on an exception.

<!-- icap recall id=q7f3a2 date=2026-11-07 verdict=holds paragraphs=2 topic="RAII" -->
> [!feedback] RAII · 2026-11-07 · ✓
> Right. One gap: copying.

## Locks

A lock_guard locks in its constructor and unlocks in its destructor.

<!-- icap check id=c1 date=2026-11-07 verdict=partly topic="Locks" -->
> [!feedback] Locks · 2026-11-07 · ≈
> Mostly right; say what happens on exception.

<!-- icap quiz id=z1 date=2026-11-07 holds=1 partly=0 reconsider=1 topic="Locks" -->
> [!practice] 理解检验 — Locks · 2026-11-07
> **1.** What releases the lock?
> *我的回答:* the destructor ✓
>
> **2.** Can a lock_guard be copied?
> *我的回答:* yes ?

<!-- icap gloss id=g9 date=2026-11-07 depth=plainer,deeper topic="the \"rule of zero\" --\> why" -->
> [!gloss] the "rule of zero" --> why
> A class that owns nothing needs no special members.
>
> **Plainly.**
> Let members clean up after themselves.
>
> **Deeper.**
> …

> [!request] Learning path for C++
> **Request:** build a learning path
>
> Created a path.

```icap-ask
id: q8
kind: recall
---
Explain move semantics in your own words.
```
