# Python References

In Python every variable is a name bound to an object. Assignment never copies the object; it binds another name to the same object. Objects are freed by reference counting (plus a cycle collector) when the last reference disappears — I never decide when that happens.

`a = [1, 2]; b = a; b.append(3)` → `a` is now `[1, 2, 3]`.

```icpa-ask
id: qsrvbhcov4
kind: request
---
Request to the agent
```
