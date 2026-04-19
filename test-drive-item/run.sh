#!/bin/bash
# Run DriveItem test harness with a peardrop link
# Usage: ./run.sh peardrop://abc123...

cd "$(dirname "$0")/.."
./node_modules/.bin/electron test-drive-item "$@"
