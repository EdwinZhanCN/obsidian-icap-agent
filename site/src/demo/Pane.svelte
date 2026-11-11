<script lang="ts">
	/*
	 * A note as Obsidian's reading view lays it out (the classes the plugin's styles and the recall veil
	 * look for), in a pane with a bar: the note's path, play again, and the ICAP style switch. The demo
	 * plays by itself while it is on screen; the note itself takes no input.
	 */
	import type { Snippet } from "svelte";
	import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
	import { autoplay } from "./player";

	let {
		path,
		zh = false,
		notice = "",
		playing = false,
		onrestart,
		play,
		el = $bindable(null),
		children,
	}: {
		path: string;
		zh?: boolean;
		notice?: string;
		playing?: boolean;
		onrestart?: () => void;
		play: { start: () => void; stop: () => void };
		children: Snippet;
		/** The pane's element, for the player to find the controls in. */
		el?: HTMLElement | null;
	} = $props();
	const t = (en: string, cn: string) => (zh ? cn : en);

	let icapStyle = $state(true);
	$effect(() => {
		document.body.classList.toggle("icap-style-theme", !icapStyle);
		return () => document.body.classList.remove("icap-style-theme");
	});
</script>

<div class="icap-demo not-content" bind:this={el} use:autoplay={play}>
	<div class="icap-demo-bar">
		<span>{path}</span>
		{#if playing}<span class="icap-demo-playing" title={t("Playing", "播放中")}></span>{/if}
		<span class="grow"></span>
		{#if onrestart}
			<button type="button" class="icap-demo-restart" onclick={onrestart} title={t("Play the example again", "重新播放这个示例")}>
				<RotateCcw size={13} aria-hidden="true" />{t("Play again", "重新播放")}
			</button>
		{/if}
		<label><input type="checkbox" bind:checked={icapStyle} /> {t("ICAP style", "ICAP 样式")}</label>
	</div>
	<div class="markdown-reading-view icap-demo-note">
		<div class="markdown-preview-sizer markdown-rendered">
			{@render children()}
		</div>
	</div>
	{#if notice}<p class="icap-demo-notice" aria-live="polite">{notice}</p>{/if}
</div>
