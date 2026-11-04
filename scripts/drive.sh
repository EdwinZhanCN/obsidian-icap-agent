#!/usr/bin/env bash
# Dev helper: drive the plugin inside the dev vault through the Obsidian CLI.
#   scripts/drive.sh select "<text>" [len]   select first occurrence (len defaults to text length)
#   scripts/drive.sh cmd <command-id>         run an icpa-agent command
#   scripts/drive.sh wait [seconds]           wait until no task is active
#   scripts/drive.sh state                    dump runtime state
#   scripts/drive.sh shot <name> [selector]   screenshot (optionally scroll selector into view first)
set -euo pipefail
V="vault=dev-vault"
SHOTS="$(cd "$(dirname "$0")/.." && pwd)/.shots"
case "$1" in
  select)
    q=$(printf '%s' "$2" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')
    obsidian $V eval code="(()=>{const e=app.workspace.activeEditor.editor;const t=e.getValue();const q=$q;const i=t.indexOf(q);if(i<0)return 'not found';const n=${3:-0}||q.length;e.setSelection(e.offsetToPos(i),e.offsetToPos(i+n));e.focus();return i})()" ;;
  cmd) obsidian $V eval code="app.commands.executeCommandById('icpa-agent:$2')" ;;
  wait)
    for _ in $(seq 1 "${2:-90}"); do
      n=$(obsidian $V eval code="app.plugins.plugins['icpa-agent'].runtime.ledger.tasks.filter(t=>t.status==='processing').length" | sed 's/=> //')
      [ "$n" = "0" ] && break; sleep 1
    done; echo "settled" ;;
  state)
    obsidian $V eval code="(()=>{const rt=app.plugins.plugins['icpa-agent'].runtime;return JSON.stringify({tasks:rt.ledger.tasks.slice(0,6).map(t=>({k:t.kind,s:t.status,p:t.phase,o:t.outcome,e:t.error,a:t.artifacts.map(a=>a.kind+':'+a.path)})),glosses:[...rt.glosses.values()].map(g=>({term:g.term,sec:g.sections.map(s=>s.status+':'+s.text.slice(0,160))})),blocks:[...rt.blocks.values()].map(b=>({k:b.kind,ph:b.phase,turns:b.turns.map(t=>({k:t.kind,q:t.question.slice(0,140),a:t.answer,fb:(t.feedback||'').slice(0,200),v:t.verdict})),sum:b.summary.slice(0,300),err:b.error}))},null,1)})()" ;;
  shot)
    if [ -n "${3:-}" ]; then obsidian $V eval code="document.querySelector('$3')?.scrollIntoView({block:'center'})" >/dev/null; sleep 0.5; fi
    obsidian $V dev:screenshot path="$SHOTS/$2.png" ;;
esac
