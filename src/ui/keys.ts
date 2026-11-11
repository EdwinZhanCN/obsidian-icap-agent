import { Scope, type App, type Modifier } from "obsidian";

/**
 * While the learner writes inside the note (an answer, a comparison), the surrounding
 * editor must not react to its hotkeys: ⌘B would bold the note, ⌘D would delete a
 * paragraph, ⌘↵ would toggle a checkbox. We push an Obsidian Scope on focus that owns
 * ⌘↵ (submit) and swallows editor-formatting chords; global ones (⌘P, ⌘O, …) still work.
 */
const EDITOR_CHORDS: [Modifier[], string][] = [
	[["Mod"], "b"],
	[["Mod"], "i"],
	[["Mod"], "k"],
	[["Mod"], "e"],
	[["Mod"], "d"],
	[["Mod"], "l"],
	[["Mod"], "/"],
	[["Mod"], "["],
	[["Mod"], "]"],
	[["Mod"], "u"],
	[["Mod", "Shift"], "Enter"],
	[["Mod", "Shift"], "k"],
	[["Mod", "Shift"], "d"],
	[["Mod", "Shift"], "ArrowUp"],
	[["Mod", "Shift"], "ArrowDown"],
	[["Alt"], "ArrowUp"],
	[["Alt"], "ArrowDown"],
];

export interface KeyGuardOptions {
	app: App;
	submit?: () => void;
	escape?: () => void;
}

export function keyGuard(node: HTMLElement, initial: KeyGuardOptions) {
	let opts = initial;
	let scope: Scope | null = null;

	const enter = () => {
		if (scope) return;
		scope = new Scope(opts.app.scope);
		scope.register(["Mod"], "Enter", () => {
			opts.submit?.();
			return false;
		});
		if (opts.escape) {
			scope.register([], "Escape", () => {
				opts.escape?.();
				return false;
			});
		}
		for (const [mods, key] of EDITOR_CHORDS) scope.register(mods, key, () => true);
		opts.app.keymap.pushScope(scope);
	};
	const leave = (e?: FocusEvent) => {
		if (e && e.relatedTarget instanceof Node && node.contains(e.relatedTarget)) return;
		if (!scope) return;
		opts.app.keymap.popScope(scope);
		scope = null;
	};

	node.addEventListener("focusin", enter);
	node.addEventListener("focusout", leave);
	if (node.contains(document.activeElement)) enter();

	return {
		update(next: KeyGuardOptions) {
			opts = next;
		},
		destroy() {
			node.removeEventListener("focusin", enter);
			node.removeEventListener("focusout", leave);
			leave();
		},
	};
}

const isTextField = (el: Element | null) =>
	!!el && (el.instanceOf(HTMLTextAreaElement) || (el.instanceOf(HTMLInputElement) && !["button", "checkbox", "radio", "submit"].includes(el.type)));

/**
 * Glosses and blocks are rendered inside CodeMirror's contenteditable. While a button or option of
 * ours has focus, the DOM selection is still in the note, so a typed key or Enter would edit the
 * note behind the learner's back. Swallow editing input in that situation (text fields are exempt).
 */
export function inertToEditor(node: HTMLElement) {
	const guard = (e: Event) => {
		const a = document.activeElement;
		if (a && node.contains(a) && !isTextField(a)) {
			e.preventDefault();
			e.stopPropagation();
		}
	};
	// Only `beforeinput` is guarded: keydown must keep bubbling, because Svelte delegates its
	// onkeydown handlers to the mount root (and CodeMirror already ignores our widgets' key events).
	window.addEventListener("beforeinput", guard, true);
	return {
		destroy() {
			window.removeEventListener("beforeinput", guard, true);
		},
	};
}
