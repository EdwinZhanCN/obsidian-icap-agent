---
icap: session
icap-id: q8k2d1x9a
tags:
  - cpp
---

> [!request] How does RAII release a lock?
> **Request:** How does [[RAII]] release a lock?
>
> The lock is held by an object; when the object goes out of scope its destructor releases the lock.
>
> **Request:** Write that up as a note.
>
> Done: [[Notes/Lock guards|Lock guards]] explains it with an example.
>
> ```cpp
> std::lock_guard<std::mutex> guard(m);
> ```
>
> **Files:** created [[Notes/Lock guards|Lock guards]]

```icap-ask
id: q8k2d1x9a
kind: request
record: live
---
Session
```
