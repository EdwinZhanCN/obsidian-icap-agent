<script lang="ts">
	/** What the learner's own Pi extensions threw during a run: a broken extension can stall it with no other sign. */
	import { L } from "../i18n";
	import { settleIn } from "./motion";

	let { errors }: { errors?: string[] } = $props();
</script>

{#if errors?.length}
	<div class="icap-ext-errors" role="status">
		<p>{L("An extension of your Pi reported an error:", "你的 Pi 中有扩展报错：")}</p>
		<ul>
			{#each errors as e (e)}
				<li use:settleIn={`ext:${e}`}>{e}</li>
			{/each}
		</ul>
	</div>
{/if}
