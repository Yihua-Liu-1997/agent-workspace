#!/bin/bash
cd ~/agent_workspace || exit 1

if [ -n "$(git status --porcelain)" ]; then
    git add -A
    git commit -m "auto-sync: $(date '+%Y-%m-%d %H:%M')"
    git push
fi
