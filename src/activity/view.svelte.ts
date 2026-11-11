/**
 * `icap-activity`: a Bases view type over task notes (FORMAT.md v5). It shows the base's own query, sort
 * and grouping, so it is a way to look at a base, not a second source of truth: the rows are the notes,
 * the strips are this device's live tasks. Display only; acting on a task stays in its block.
 */
import { BasesView, Keymap, TFile, type QueryController } from "obsidian";
import { mount, unmount } from "svelte";
import ActivityView from "./ActivityView.svelte";
import { rowOf, type ActivityData, type ActivityGroup, type ActivityRow } from "./rows";
import type { Task } from "../runtime/state.svelte";
import { ACTIVITY_VIEW_TYPE } from "../dsl/task-notes";

export const ACTIVITY_VIEW = ACTIVITY_VIEW_TYPE;

export interface ActivityHost {
	taskOf(id: string): Task | undefined;
	/** Open where the task was asked; false when its note is gone (runtime.openTask). */
	openTask(id: string, source: string | null, request: string, from: string): Promise<boolean>;
}

export class ActivityBasesView extends BasesView {
	type = ACTIVITY_VIEW;
	private data$ = $state<ActivityData>({ groups: [] });
	private component: ReturnType<typeof mount> | null = null;

	constructor(
		controller: QueryController,
		private el: HTMLElement,
		private host: ActivityHost,
	) {
		super(controller);
	}

	onload() {
		this.el.addClass("icap-activity-host");
		const data = () => this.data$;
		this.component = mount(ActivityView, {
			target: this.el,
			props: {
				get data() {
					return data();
				},
				live: (id: string) => this.host.taskOf(id),
				open: (path: string, ev: MouseEvent | KeyboardEvent) => void this.app.workspace.openLinkText(path, "", Keymap.isModEvent(ev)),
				openTask: (row: ActivityRow, ev: MouseEvent | KeyboardEvent) => void this.openTask(row, ev),
			},
		});
	}

	/** A task's name leads to where it was asked; with Mod, or when that note is gone, to its task note. */
	private async openTask(row: ActivityRow, ev: MouseEvent | KeyboardEvent) {
		const own = Keymap.isModEvent(ev);
		if (own || !(await this.host.openTask(row.id, row.source, row.title, row.path))) void this.app.workspace.openLinkText(row.path, "", own);
	}

	onunload() {
		if (this.component) void unmount(this.component);
		this.component = null;
		this.el.removeClass("icap-activity-host");
		this.el.empty();
	}

	onDataUpdated() {
		const groups: ActivityGroup[] = [];
		for (const g of this.data.groupedData) {
			const rows = [];
			for (const e of g.entries) {
				const file = e.file;
				if (!(file instanceof TFile)) continue;
				const row = rowOf(file.path, file.basename, this.app.metadataCache.getFileCache(file)?.frontmatter);
				if (row) rows.push(row);
			}
			if (rows.length || g.hasKey()) groups.push({ key: g.hasKey() ? (g.key?.toString() ?? null) : null, rows });
		}
		this.data$ = { groups };
	}
}
