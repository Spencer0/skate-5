# Agent instructions

Ship every change straight to mainline. Once a change is done and verified
(`npx tsc --noEmit`, `npm test`, `npx vite build`), commit it and push it to
`main`: no feature branches, no pull requests, no waiting for approval.

If `main` has moved, fetch, merge `origin/main` into your work, re-run the checks, then push.
