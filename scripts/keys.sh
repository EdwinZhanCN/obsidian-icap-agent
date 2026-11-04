#!/usr/bin/env bash
# Real (trusted) keyboard input into Obsidian through CDP, for keyboard-flow tests.
#   scripts/keys.sh key <Key> <Code> <vk> [modifiers]   modifiers: 1 alt, 2 ctrl, 4 meta, 8 shift
#   scripts/keys.sh type "<text>"
#   scripts/keys.sh palette "<command name>"            ⌘P, type, ↵
#   scripts/keys.sh focus                               describe document.activeElement
set -euo pipefail
V="vault=dev-vault"
key() { obsidian $V dev:cdp method=Input.dispatchKeyEvent params="{\"type\":\"rawKeyDown\",\"key\":\"$1\",\"code\":\"$2\",\"windowsVirtualKeyCode\":$3,\"modifiers\":${4:-0}}" >/dev/null
        obsidian $V dev:cdp method=Input.dispatchKeyEvent params="{\"type\":\"keyUp\",\"key\":\"$1\",\"code\":\"$2\",\"windowsVirtualKeyCode\":$3,\"modifiers\":${4:-0}}" >/dev/null; }
typ() { q=$(printf '%s' "$1" | python3 -c 'import json,sys;print(json.dumps({"text":sys.stdin.read()}))'); obsidian $V dev:cdp method=Input.insertText params="$q" >/dev/null; }
case "$1" in
  key) key "$2" "$3" "$4" "${5:-0}" ;;
  type) typ "$2" ;;
  palette) key p KeyP 80 4; sleep 0.4; typ "$2"; sleep 0.4; key Enter Enter 13; sleep 0.4 ;;
  focus) obsidian $V eval code="(()=>{const a=document.activeElement;const r=a.closest('.icpa-gloss,.icpa-ask,.icpa-ledger,.cm-content,.prompt');return (r?r.className.split(' ')[0]:'-')+' > '+a.tagName.toLowerCase()+(a.getAttribute('role')?'['+a.getAttribute('role')+']':'')+' \"'+(a.textContent||a.value||'').trim().slice(0,30)+'\"'})()" ;;
esac
