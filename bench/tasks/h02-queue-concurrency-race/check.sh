#!/bin/sh
# Usage: check.sh <workdir>. Exits 0 only when the task is solved: the hidden check passes and the
# project's own tests still pass.
set -e
here=$(cd "$(dirname "$0")" && pwd)
cd "$1"
WORK_DIR="$1" bun test "$here/check.test.ts"
bun test
