---
tags: [cpp, memory]
course: Systems Programming
---
# C++ Memory Management

C++ gives you direct control over where objects live. Automatic objects live on the **stack** and are destroyed when they go out of scope; dynamically allocated objects live on the **heap** and must be released explicitly. Forgetting to release heap memory causes leaks, and releasing it twice causes undefined behaviour.

Unlike Python, where every name is a reference to an object managed by the interpreter, a C++ `pointer` is a plain value that holds an address. Copying a pointer copies the address, not the object. See [[Python References]] for how I understood the Python side.

## RAII

The idiom that makes manual memory management bearable is RAII (Resource Acquisition Is Initialization): a resource is acquired in a constructor and released in the destructor. Because destructors run deterministically when an object leaves scope — even during stack unwinding after an exception — the resource cannot leak.

```cpp
void write_log(const std::string& msg) {
    std::lock_guard<std::mutex> guard(log_mutex); // locked here
    log_file << msg << '\n';
}                                                 // unlocked here, always
```

RAII is not limited to memory: files, sockets, locks and GPU buffers all follow the same pattern.

## Smart pointers

- `std::unique_ptr` expresses sole ownership; it cannot be copied, only moved.
- `std::shared_ptr` uses reference counting; the object is destroyed when the last owner goes away.
- `std::weak_ptr` observes a `shared_ptr` without extending its lifetime, which breaks reference cycles.

The cost of `shared_ptr` is an atomic increment on every copy, so prefer `unique_ptr` unless ownership is genuinely shared. The complexity of an ownership graph is roughly $O(n)$ in the number of owners you have to reason about.

## My understanding

RAII basically means the garbage collector frees the object automatically when nothing points at it anymore, so you never have to call delete.
