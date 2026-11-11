/**
 * Plays a demonstration: types into the plugin's own writing line and selects its own buttons, as a
 * learner would. The reader only watches (the note in a demo pane takes no pointer input). It plays
 * while the demo is on screen and stops when it leaves.
 */

class Stopped extends Error {}

/** The pause before each move: time to read what the agent just wrote. */
const READ = 1600;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Steps {
	wait(ms: number): Promise<void>;
	/** Wait until `f` is true (the agent has replied, a control has appeared). */
	until(f: () => unknown, timeout?: number): Promise<void>;
	/** Select the enabled button with this text. */
	click(label: string): Promise<void>;
	/** Select the option whose text contains `label`. */
	choose(label: string): Promise<void>;
	/** Type into the writing line; `replace` clears what is there first. */
	type(text: string, replace?: boolean): Promise<void>;
	/** Select the entry with this name in the list the writing line offers (a file after `[[`, a command after `/`). */
	pick(name: string): Promise<void>;
}

export function player(root: () => HTMLElement | null | undefined) {
	let run = 0;

	function steps(mine: number): Steps {
		const check = () => {
			if (mine !== run) throw new Stopped();
		};
		const wait = async (ms: number) => {
			await sleep(ms);
			check();
		};
		const until = async (f: () => unknown, timeout = 20_000) => {
			const end = Date.now() + timeout;
			while (!f()) {
				if (Date.now() > end) throw new Stopped();
				await wait(100);
			}
		};
		const all = <T extends Element>(sel: string) => Array.from(root()?.querySelectorAll<T>(sel) ?? []);
		const button = (label: string) => all<HTMLButtonElement>("button").find((b) => b.innerText.trim() === label && !b.disabled);
		const option = (label: string) => all<HTMLElement>('[role="radio"], [role="checkbox"]').find((o) => o.innerText.includes(label) && o.getAttribute("aria-disabled") !== "true");
		const field = () => all<HTMLTextAreaElement>("textarea").at(-1);
		const entry = (name: string) => all<HTMLButtonElement>(".icap-link-suggest button").find((b) => b.querySelector(".icap-link-name")?.textContent?.trim() === name);
		return {
			wait,
			until,
			async pick(name) {
				await until(() => entry(name));
				await wait(READ / 2);
				// the list takes the pointer on mousedown, so the writing line keeps the focus
				entry(name)?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
				await wait(300);
			},
			async click(label) {
				await until(() => button(label));
				await wait(READ);
				button(label)?.click();
			},
			async choose(label) {
				await until(() => option(label));
				await wait(READ + 400);
				option(label)?.click();
			},
			async type(text, replace = false) {
				await until(field);
				await wait(READ);
				const ta = field()!;
				ta.focus({ preventScroll: true });
				const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
				let value = replace ? "" : ta.value;
				if (replace) {
					set.call(ta, "");
					ta.dispatchEvent(new Event("input", { bubbles: true }));
				}
				// CJK text is typed a little slower per character, so both languages take about as long
				const pace = /[　-鿿]/.test(text) ? 70 : 28;
				for (const ch of text) {
					value += ch;
					set.call(ta, value);
					ta.dispatchEvent(new Event("input", { bubbles: true }));
					await wait(pace + Math.random() * 30);
				}
			},
		};
	}

	return {
		/** Play `script` from the start; a running play is stopped first. */
		async play(script: (s: Steps) => Promise<void>) {
			const mine = ++run;
			try {
				await script(steps(mine));
			} catch (e) {
				if (!(e instanceof Stopped)) throw e;
			}
		},
		stop() {
			run++;
		},
	};
}

/** `use:autoplay={{ start, stop }}`: play while the demo is on screen. */
export function autoplay(node: HTMLElement, o: { start: () => void; stop: () => void }) {
	const seen = new IntersectionObserver(([e]) => (e.isIntersecting ? o.start() : o.stop()), { threshold: 0.5 });
	seen.observe(node);
	return { destroy: () => seen.disconnect() };
}
