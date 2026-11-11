<script lang="ts">
	/* One question or request block, held in one state: nothing runs. */
	import AskView from "@plugin/ui/AskView.svelte";
	import type { AskBlock } from "@plugin/runtime/state.svelte";
	import type { DemoRuntime } from "./runtime.svelte";

	let { block, rt, path }: { block: AskBlock; rt: DemoRuntime; path: string } = $props();
	let host = $state<HTMLElement | null>(null);
	// svelte-ignore state_referenced_locally
	rt.blocks.set(block.id, block);
</script>

<div bind:this={host}>
	{#if host}<AskView {block} id={block.id} title={block.topic} rt={rt as never} sourcePath={path} {host} />{/if}
</div>
