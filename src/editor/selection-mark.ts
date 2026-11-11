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
 *
 * On a phone or tablet it is docked instead, above Obsidian's mobile toolbar (or the bottom of the
 * screen). Next to the selection it sat where the finger goes to drag the selection's handle, and
 * where iOS and Android draw their own Copy / Look Up menu, whose place changes with the platform and
 * the room left; docked, it is never in the way of either.
 */

/** Phone or tablet (also desktop's app.emulateMobile): read each time, since emulation can change. */
const docked = () => document.body.classList.contains("is-mobile");
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
			// A long press that selects text ends in pointercancel, not pointerup: the system takes the touch
			// over. Without this the pointer counted as down until the next tap, and nothing showed.
			onCancel = () => {
				this.pointerDown = false;
				this.schedule();
			};
			/** Docked: the selection can change through the system's handles alone, with no pointer event of ours. */
			onSelectionChange = () => {
				if (docked() && this.focused()) this.schedule();
			};
			onScroll = () => this.position();
			onViewport = () => {
				if (this.el.classList.contains("is-shown") && this.el.classList.contains("is-docked")) this.dock();
			};

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
					// Keep the selection and the editor's focus: on touch, preventing pointerdown also stops
					// the mousedown that would move the focus (the click still comes).
					b.addEventListener("pointerdown", (e) => e.preventDefault());
					b.addEventListener("mousedown", (e) => e.preventDefault());
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
				document.addEventListener("pointercancel", this.onCancel);
				document.addEventListener("selectionchange", this.onSelectionChange);
				view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
				window.visualViewport?.addEventListener("resize", this.onViewport);
				window.visualViewport?.addEventListener("scroll", this.onViewport);
			}

			update(u: ViewUpdate) {
				if (u.docChanged) {
					this.hide();
					return;
				}
				if (u.selectionSet || u.focusChanged) this.schedule();
				else if (u.geometryChanged && this.el.classList.contains("is-shown")) this.position();
			}

			/**
			 * The editor has the focus. CodeMirror's hasFocus also wants the document to have it, which a
			 * phone's WebView can deny while the system's selection menu is up; docked, the editor being the
			 * focused element is enough.
			 */
			focused(): boolean {
				return this.view.hasFocus || (docked() && this.view.root.activeElement === this.view.contentDOM);
			}

			schedule() {
				if (this.timer) window.clearTimeout(this.timer);
				const sel = this.view.state.selection.main;
				// Docked, it stays while the learner adjusts the selection with its handles: nothing to dodge.
				if (docked() && this.el.classList.contains("is-docked") && this.el.classList.contains("is-shown") && !sel.empty && this.focused() && host.enabled()) return;
				this.hide();
				if (!host.enabled()) return;
				// Next to the selection it waits for the pointer to lift; docked, where the finger is does not matter.
				if (sel.empty || (this.pointerDown && !docked())) return;
				this.timer = window.setTimeout(() => this.show(), docked() ? 500 : 420);
			}

			show() {
				const sel = this.view.state.selection.main;
				const text = this.view.state.sliceDoc(sel.from, sel.to).trim();
				if (!this.focused() || sel.empty || !text || text.length > 2400) return;
				this.el.classList.toggle("is-long", text.length > 120);
				const was = this.el.classList.contains("is-shown");
				const dock = docked();
				// Docked it is fixed to the screen, so it lives on the body (an ancestor's transform would move it).
				const home = dock ? document.body : this.view.dom;
				if (this.el.parentElement !== home) home.appendChild(this.el);
				this.el.classList.toggle("is-docked", dock);
				if (dock) this.dock();
				else this.position();
				this.el.classList.add("is-shown");
				// The mark is set down next to the selection's end, like a pencil tick in the margin; docked, it rises.
				if (!was) play(this.el, dock ? { opacity: [0, 1], y: [6, 0] } : { opacity: [0, 1], y: [-3, 0], scale: [0.96, 1] }, spring.quick);
			}

			/** Docked: just above Obsidian's mobile toolbar when it is up, else above the keyboard or the screen's edge. */
			dock() {
				const toolbar = Array.from(document.querySelectorAll<HTMLElement>(".mobile-toolbar")).find((t) => t.getBoundingClientRect().height > 0);
				const vv = window.visualViewport;
				const bottomOfView = vv ? vv.offsetTop + vv.height : window.innerHeight;
				const above = toolbar ? Math.min(toolbar.getBoundingClientRect().top, bottomOfView) : bottomOfView;
				const gap = Math.max(0, window.innerHeight - above) + 8;
				this.el.style.left = "";
				this.el.style.top = "";
				this.el.style.bottom = toolbar ? `${gap}px` : `calc(${gap}px + env(safe-area-inset-bottom))`;
			}

			/** Layout is read in CodeMirror's measure phase (never during an update). */
			position() {
				if (this.el.classList.contains("is-docked")) return;
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
						this.el.style.bottom = "";
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
				document.removeEventListener("pointercancel", this.onCancel);
				document.removeEventListener("selectionchange", this.onSelectionChange);
				this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
				window.visualViewport?.removeEventListener("resize", this.onViewport);
				window.visualViewport?.removeEventListener("scroll", this.onViewport);
				this.el.remove();
			}
		},
	);
}
