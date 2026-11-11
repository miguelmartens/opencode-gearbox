Something is off with `TaskQueue` in `src/queue.ts`. We use it through `uploadAll(files, upload, concurrency)` in `src/uploader.ts`, and in production we see two things:

- With `concurrency: 3` the storage backend sometimes sees 4 or 5 uploads from us at once. It seems to happen after some uploads fail.
- `uploadAll` sometimes resolves while uploads are still running, and those files are then missing from the report (neither `uploaded` nor `failed`).

The existing tests pass, and with concurrency 1 and no failures everything looks fine.

The queue should guarantee: tasks start in FIFO order; at most `concurrency` tasks run at once, whether they resolve, reject or throw synchronously; the promise from `add()` settles with the task's own result or error; `running` and `size` are always accurate; and `onIdle()` resolves only once nothing is running and nothing is queued (right away if the queue is already idle).

Find the root cause first and explain it; don't change code yet.

---

ok, continue
