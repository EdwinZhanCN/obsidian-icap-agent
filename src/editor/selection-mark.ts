import { L } from "../i18n";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { play, spring } from "../ui/motion";

export interface SelectionMarkHost {
	enabled(): boolean;
	explain(view: EditorView): void;
	check(view: EditorView): void;
}

/**
 * A quiet affordance: after a selection settles (and the pointer is up), a small mark
 * appears just below the selection's end. It never steals focus and disappears on typing,
 * scrolling away, or collapsing the selection.
 */
export function selectionMark(host: SelectionMarkHost) {
	return ViewPlugin.fromClass(
		class {
			el: HTMLElement;
			timer: number | null = null;
			pointerDown = false;
			onDown = () => {
				this.pointerDown = true;
				this.hide();
			};
			onUp = () => {
				this.pointerDown = false;
				this.schedule();
			};
			onScroll = () => this.position();

			constructor(readonly view: EditorView) {
				this.el = document.createElement("div");
				this.el.className = "icap-selmark";
				this.el.setAttribute("role", "toolbar");
				this.el.setAttribute("aria-label", L("Learning actions for selection", "对选中内容的学习操作"));
				const mk = (label: string, title: string, fn: () => void) => {
					const b = document.createElement("button");
					b.type = "button";
					b.textContent = label;
					b.title = title;
					b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection
					b.addEventListener("click", (e) => {
						e.preventDefault();
						this.hide();
						fn();
					});
					return b;
				};
				const sep = document.createElement("span");
				sep.className = "icap-selmark-sep";
				sep.textContent = "·";
				this.el.append(
					mk(L("explain", "解释"), L("Explain this in context", "在上下文中解释这段内容"), () => host.explain(this.view)),
					sep,
					mk(L("check my words", "检查我的说法"), L("Check the understanding written here", "检查这里写下的理解"), () => host.check(this.view)),
				);
				view.dom.appendChild(this.el);
				view.contentDOM.addEventListener("pointerdown", this.onDown);
				document.addEventListener("pointerup", this.onUp);
				view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
			}

			update(u: ViewUpdate) {
				if (u.docChanged) {
					this.hide();
					return;
				}
				if (u.selectionSet || u.focusChanged) this.schedule();
				else if (u.geometryChanged && this.el.classList.contains("is-shown")) this.position();
			}

			schedule() {
				if (this.timer) window.clearTimeout(this.timer);
				this.hide();
				if (!host.enabled()) return;
				const sel = this.view.state.selection.main;
				if (sel.empty || this.pointerDown) return;
				this.timer = window.setTimeout(() => this.show(), 420);
			}

			show() {
				const sel = this.view.state.selection.main;
				const text = this.view.state.sliceDoc(sel.from, sel.to).trim();
				if (!this.view.hasFocus || sel.empty || !text || text.length > 2400) return;
				this.el.classList.toggle("is-long", text.length > 120);
				const was = this.el.classList.contains("is-shown");
				this.position();
				this.el.classList.add("is-shown");
				// The mark is set down next to the selection's end, like a pencil tick in the margin.
				if (!was) play(this.el, { opacity: [0, 1], y: [-3, 0], scale: [0.96, 1] }, spring.quick);
			}

			/** Layout is read in CodeMirror's measure phase (never during an update). */
			position() {
				this.view.requestMeasure({
					key: this,
					read: (view) => {
						const sel = view.state.selection.main;
						if (sel.empty) return null;
						const end = view.coordsAtPos(sel.to, -1);
						const host = view.dom.getBoundingClientRect();
						const scroller = view.scrollDOM.getBoundingClientRect();
						if (!end || end.bottom < scroller.top || end.top > scroller.bottom) return null;
						const width = this.el.offsetWidth || 160;
						return {
							left: Math.min(Math.max(8, end.right - host.left - 12), host.width - width - 12),
							top: end.bottom - host.top + 6,
						};
					},
					write: (at) => {
						if (!at) return void this.el.classList.remove("is-shown");
						this.el.style.left = `${at.left}px`;
						this.el.style.top = `${at.top}px`;
					},
				});
			}

			hide() {
				this.el.classList.remove("is-shown");
			}

			destroy() {
				if (this.timer) window.clearTimeout(this.timer);
				this.view.contentDOM.removeEventListener("pointerdown", this.onDown);
				document.removeEventListener("pointerup", this.onUp);
				this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
				this.el.remove();
			}
		},
	);
}
