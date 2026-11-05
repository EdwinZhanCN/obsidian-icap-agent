<script lang="ts">
	import { Platform } from "obsidian";
	import Command from "@lucide/svelte/icons/command";
	import CornerDownLeft from "@lucide/svelte/icons/corner-down-left";
	import { L } from "../i18n";

	/**
	 * A shortcut as keycaps, for hints and captions. `mod` (the default) is the writing line's submit,
	 * Mod+Enter (ui/keys.ts): ⌘ ↵ on macOS and Ctrl ↵ elsewhere, like Obsidian's own hotkey display;
	 * without it, Enter alone. The glyph keys are Lucide icons so they look the same in every theme font.
	 */
	let { mod = true }: { mod?: boolean } = $props();
	const mac = Platform.isMacOS;
	const spoken = $derived(mod ? (mac ? L("Command Return", "Command 回车") : L("Ctrl Enter", "Ctrl 回车")) : L("Enter", "回车"));
</script>

<span class="icap-keys"
	>{#if mod}<kbd aria-hidden="true">{#if mac}<Command />{:else}Ctrl{/if}</kbd>{/if}<kbd aria-hidden="true"><CornerDownLeft /></kbd><span
		class="icap-sr">{spoken}</span
	></span
>
