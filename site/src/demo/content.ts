/**
 * What the demonstrations say, in both languages. One short note about lift runs through every page,
 * so the site reads like one lesson. The agent's replies are written to the same rules as a real reply:
 * they answer what the learner wrote, and they do not give the answer away.
 */
import type { Answer, AskBlock, Turn } from "@plugin/runtime/state.svelte";
import type { BlockScript, GlossScript, Reply } from "./runtime.svelte";
import { L } from "@plugin/i18n";
import type { Steps } from "./player";

export type Lang = "en" | "zh";
export type DemoKind = "recall" | "check" | "quiz" | "agent" | "collect";

const pick = <T,>(lang: Lang, en: T, zh: T) => (lang === "zh" ? zh : en);

export const note = (lang: Lang) =>
	pick(
		lang,
		{
			title: "Lift",
			path: "Lift.md",
			before: "A wing makes lift because it turns the air that flows past it downward. By Newton's third law, the air pushes the wing up.",
			term: "angle of attack",
			sentence: ["The ", "angle of attack", " is the angle between the wing and the air that comes toward it."],
			after: "Up to a limit, a larger angle turns more air and gives more lift. Past that limit, the air separates from the upper surface, and the wing stalls.",
			mine: "I think lift grows with the angle of attack. When the angle doubles, the lift also doubles, so a steeper wing always lifts more.",
		},
		{
			title: "升力",
			path: "升力.md",
			before: "机翼产生升力，是因为它把流过的空气向下偏转。根据牛顿第三定律，空气把机翼向上推。",
			term: "迎角",
			sentence: ["", "迎角", "是机翼与迎面而来的气流之间的夹角。"],
			after: "在一定限度内，迎角越大，偏转的空气越多，升力也越大。超过这个限度，气流从上表面分离，机翼失速。",
			mine: "我认为升力随迎角增大而增大。迎角加倍，升力也加倍，所以机翼越陡，升力总是越大。",
		},
	);

export const gloss = (lang: Lang): GlossScript =>
	pick<GlossScript>(
		lang,
		{
			explain:
				"The **angle of attack** is the angle between the wing's chord line (a straight line from the front edge to the back edge) and the direction of the air that meets the wing. It is not the angle between the wing and the ground: an aircraft that climbs can have a small angle of attack.",
			deeper:
				"Lift is about proportional to the angle of attack, up to the *critical angle* (about 15° for many wings). At that angle the air on the upper surface can no longer follow the curve. It separates, and lift falls quickly. This is why a stall depends on the angle, not on the speed.",
			example:
				"Hold your hand flat out of a car window. Tilt the front edge up a little: your hand rises. Tilt it more: it rises more. Tilt it nearly vertical: your hand is pushed back, not up. You went past the critical angle.",
			simpler: "It is how much the wing tilts against the air that comes at it. More tilt gives more lift, until too much tilt makes the wing lose its lift.",
			compare: (other) =>
				`The angle of attack is measured against the **air**; ${other} is a different idea, and the two are easy to mix up. A wing can keep the same ${other} and still change its angle of attack when the air changes direction, for example in a gust.`,
		},
		{
			explain: "**迎角**是机翼弦线（从前缘到后缘的直线）与迎面气流方向之间的夹角。它不是机翼与地面的夹角：一架正在爬升的飞机，迎角可以很小。",
			deeper: "在*临界迎角*（很多机翼约为 15°）以内，升力大致与迎角成正比。到了临界迎角，上表面的气流无法再沿曲面流动，于是分离，升力迅速下降。所以失速取决于迎角，而不是速度。",
			example: "把手平伸出车窗。前缘稍微抬起，手往上走；再抬高一些，手走得更高；抬到接近竖直，手被向后推，而不是向上。你越过了临界迎角。",
			simpler: "就是机翼迎着气流倾斜了多少。倾斜越多，升力越大；倾斜太多，机翼就失去升力。",
			compare: (other) => `迎角是相对**气流**来量的；${other}是另一个概念，两者很容易混淆。即使${other}不变，气流方向一变（比如遇到阵风），迎角也会变。`,
		},
	);

/** The block as the note's author wrote it: its kind, topic and first question. */
export function authored(lang: Lang, kind: DemoKind): { topic: string; first?: Omit<Turn, "id"> } {
	const n = note(lang);
	switch (kind) {
		case "recall":
			return {
				topic: n.title,
				first: {
					kind: "text",
					local: true,
					question: pick(
						lang,
						"Without looking back: why does a larger angle of attack give more lift, and what happens past the limit?",
						"不要回头看：为什么迎角越大升力越大？超过限度后会发生什么？",
					),
					placeholder: pick(lang, "In your own words…", "用你自己的话…"),
				},
			};
		case "check":
			return { topic: n.title, first: { kind: "text", local: true, inNote: true, question: "", answer: { text: n.mine } } };
		case "quiz":
			return {
				topic: pick(lang, "Angle of attack", "迎角"),
				first: {
					kind: "single",
					local: true,
					question: pick(lang, "At a constant speed, a pilot slowly raises the nose. What happens to the lift first?", "速度不变时，飞行员慢慢抬起机头。升力首先会怎样？"),
					options: pick(
						lang,
						[
							{ id: "a", label: "It decreases" },
							{ id: "b", label: "It increases" },
							{ id: "c", label: "It stays the same" },
						],
						[
							{ id: "a", label: "减小" },
							{ id: "b", label: "增大" },
							{ id: "c", label: "不变" },
						],
					),
				},
			};
		case "agent":
			return { topic: pick(lang, "Concept note: angle of attack", "概念笔记：迎角") };
		case "collect":
			// a block the agent opens: its topic is the note's name (runtime.ts, ensureAgentBlock)
			return { topic: n.title };
	}
}

const textOf = (a: Answer) => (a.text ?? "").trim();

/** How the agent goes on after each answer. */
export function script(lang: Lang, kind: DemoKind): BlockScript {
	return (block: AskBlock, turn: Turn, answer: Answer): Reply => {
		const round = block.turns.filter((t) => t.answer).length;
		if (kind === "recall") {
			if (round === 1)
				return {
					feedback: pick(
						lang,
						textOf(answer).length < 40
							? "You named the effect, but not the cause. Say what the wing does to the air."
							: "Good: you connect the angle with the air the wing turns. You did not say what happens past the limit.",
						textOf(answer).length < 15 ? "你说出了结果，但没有说原因。说说机翼对空气做了什么。" : "不错：你把迎角和机翼偏转的空气联系起来了。但你没有说超过限度后会怎样。",
					),
					verdict: "partly",
					next: {
						kind: "text",
						question: pick(lang, "Past the limit, the air on the upper surface changes. What does it do, and what happens to the lift?", "超过限度后，上表面的气流会改变。它怎么变？升力又会怎样？"),
						placeholder: pick(lang, "Your answer…", "你的回答…"),
					},
				};
			return {
				verdict: "holds",
				summary: pick(
					lang,
					"Your explanation now has the cause (the wing turns air down), the effect (more lift with a larger angle) and the limit (the air separates, and the wing stalls). To make it complete, add the critical angle: about 15° for many wings.",
					"你的解释现在有了原因（机翼把空气向下偏转）、结果（迎角越大升力越大）和限度（气流分离，机翼失速）。要更完整，可以补上临界迎角：很多机翼约为 15°。",
				),
			};
		}
		if (kind === "check") {
			if (round === 1)
				return {
					next: {
						kind: "text",
						question: pick(
							lang,
							"You wrote that a steeper wing **always** lifts more. Think of a wing that is almost vertical to the air. Does it still lift more?",
							"你写的是机翼越陡，升力**总是**越大。想一想几乎垂直于气流的机翼。它的升力还会更大吗？",
						),
						placeholder: pick(lang, "Your answer…", "你的回答…"),
					},
				};
			return {
				verdict: "partly",
				summary: pick(
					lang,
					"Two points in your paragraph need a change. **Always** is not correct: past the critical angle, the air separates and lift falls. **Doubles** is only about correct for small angles. The rest of your paragraph holds.",
					"你这段话有两处需要修改。**总是**不对：超过临界迎角，气流分离，升力下降。**加倍**只在迎角较小时大致成立。其余部分成立。",
				),
			};
		}
		if (kind === "quiz") {
			if (round === 1) {
				const right = answer.choices?.[0] === "b";
				return {
					feedback: right
						? pick(lang, "Correct. A larger angle turns more air, so lift increases.", "正确。迎角越大，偏转的空气越多，所以升力增大。")
						: pick(lang, "Not this one. Raising the nose increases the angle of attack. What does a larger angle do to the air that the wing turns?", "不是这个。抬起机头会增大迎角。迎角变大，机翼偏转的空气会怎样？"),
					verdict: right ? "holds" : "reconsider",
					next: {
						kind: "single",
						question: pick(lang, "The pilot keeps raising the nose past the critical angle. What happens?", "飞行员继续抬头，超过了临界迎角。会发生什么？"),
						options: pick(
							lang,
							[
								{ id: "a", label: "Lift keeps increasing" },
								{ id: "b", label: "The air separates and lift falls" },
								{ id: "c", label: "The aircraft speeds up" },
							],
							[
								{ id: "a", label: "升力继续增大" },
								{ id: "b", label: "气流分离，升力下降" },
								{ id: "c", label: "飞机加速" },
							],
						),
					},
				};
			}
			const right = answer.choices?.[0] === "b";
			return {
				feedback: right ? pick(lang, "Correct. This is a stall.", "正确。这就是失速。") : pick(lang, "No. Past the critical angle, the air separates from the upper surface, and lift falls.", "不对。超过临界迎角，气流从上表面分离，升力下降。"),
				verdict: right ? "holds" : "reconsider",
				summary: pick(lang, "You can tell how lift changes with the angle of attack. Next, connect it with speed: why does a slow aircraft need a larger angle?", "你能判断升力如何随迎角变化。下一步，把它和速度联系起来：为什么飞得慢的飞机需要更大的迎角？"),
			};
		}
		if (kind === "collect") {
			const n = note(lang);
			if (round === 1) {
				const chosen = answer.choices ?? [];
				const made = collectNotes(lang).filter((_, i) => chosen.includes(String.fromCharCode(97 + i)));
				collected = made;
				// it created the notes, and proposes ONE edit: a link at the first plain mention
				return {
					next: {
						kind: "review",
						question: pick(lang, `Link the first mention of “${n.term}” to the new note [[${made[0] ?? n.term}]].`, `把第一次出现的「${n.term}」链接到新笔记[[${made[0] ?? n.term}]]。`),
						review: { path: n.path, find: n.sentence.join(""), replace: linkedSentence(lang), summary: "" },
					},
				};
			}
			const list = collected.map((t) => `[[${t}]]`).join(pick(lang, " and ", "和"));
			return {
				summary: answer.confirmed
					? pick(lang, `I created ${list}, and linked the first mention in [[${n.title}]].`, `我新建了${list}，并在[[${n.title}]]中链接了第一次出现的地方。`)
					: pick(lang, `I created ${list}. [[${n.title}]] did not change.`, `我新建了${list}。[[${n.title}]]没有改动。`),
			};
		}
		// agent: it asked which definition to use, then it writes the note.
		if (round === 1)
			return {
				summary: pick(
					lang,
					"I wrote [[Angle of attack]] with the definition you chose, and added a link to it in [[Lift]].",
					"我按你选的定义写了 [[迎角]]，并在 [[升力]] 中加了指向它的链接。",
				),

			};
		return { summary: "" };
	};
}

/** The agent's question in the "agent" demo: asked while it works, before it writes. */
export const agentQuestion = (lang: Lang): Omit<Turn, "id"> => ({
	kind: "single",
	question: pick(
		lang,
		"Your notes define the angle of attack in two ways: against the **oncoming air**, and against the **horizon**. Which one should the concept note use?",
		"你的笔记对迎角有两种定义：相对**迎面气流**，以及相对**地平线**。概念笔记用哪一种？",
	),
	options: pick(
		lang,
		[
			{ id: "a", label: "Against the oncoming air" },
			{ id: "b", label: "Against the horizon" },
			{ id: "c", label: "Both, and explain the difference" },
		],
		[
			{ id: "a", label: "相对迎面气流" },
			{ id: "b", label: "相对地平线" },
			{ id: "c", label: "两种都写，并说明区别" },
		],
	),
});

/** The concepts the agent offers in the "collect" demo, as note titles (in the order of its options). */
const collectNotes = (lang: Lang) => pick(lang, ["Angle of attack", "Critical angle", "Stall"], ["迎角", "临界迎角", "失速"]);
/** The notes the learner chose in the current run. */
let collected: string[] = [];

/** The note's sentence once its first mention links to the new concept note. */
export const linkedSentence = (lang: Lang) =>
	pick(lang, "The [[Angle of attack|angle of attack]] is the angle between the wing and the air that comes toward it.", "[[迎角]]是机翼与迎面而来的气流之间的夹角。");

/** "Collect key concepts of this note into notes": the agent asks which concepts get a note first. */
export const collectQuestion = (lang: Lang): Omit<Turn, "id"> => ({
	kind: "multi",
	question: pick(lang, "Which key concepts of this note should get a note of their own?", "这篇笔记的哪些关键概念应该有自己的笔记？"),
	options: pick(
		lang,
		[
			{ id: "a", label: "Angle of attack — the angle between the wing and the oncoming air" },
			{ id: "b", label: "Critical angle — the angle where lift stops growing" },
			{ id: "c", label: "Stall — what happens past the critical angle" },
		],
		[
			{ id: "a", label: "迎角——机翼与迎面气流之间的夹角" },
			{ id: "b", label: "临界迎角——升力不再增大的角度" },
			{ id: "c", label: "失速——超过临界迎角后发生的事" },
		],
	),
});

/* ───────────── what the learner does, played back ───────────── */


/** The learner's moves in each question block, with the plugin's own control names. */
export function moves(lang: Lang, kind: DemoKind): (s: Steps) => Promise<void> {
	const submit = L("submit", "提交");
	const keep = L("keep in note", "留在笔记里");
	switch (kind) {
		case "recall":
			return async (s) => {
				await s.type(pick(lang, "A bigger angle turns more air down, so the air pushes the wing up harder.", "迎角越大，机翼向下偏转的空气越多，空气就把机翼推得更用力。"));
				await s.click(submit);
				await s.type(pick(lang, "The air separates from the top, and the lift falls. The wing stalls.", "气流从上表面分离，升力下降，机翼失速。"));
				await s.click(submit);
				await s.click(L("write it up", "整理成文"));
				await s.type(
					pick(lang, " Past the critical angle (about 15°), the air separates from the top, and the wing stalls.", "超过临界迎角（约 15°），气流从上表面分离，机翼失速。"),
				);
				await s.click(keep);
			};
		case "check":
			return async (s) => {
				await s.type(pick(lang, "No. Near vertical, the air separates, and the lift falls.", "不会。接近垂直时，气流分离，升力下降。"));
				await s.click(submit);
				await s.click(L("revise my words", "修改我的说法"));
				await s.type(
					pick(
						lang,
						"Lift grows with the angle of attack, up to the critical angle. Past it, the air separates, and the lift falls.",
						"在临界迎角以内，升力随迎角增大而增大。超过临界迎角，气流分离，升力下降。",
					),
					true,
				);
				await s.click(L("update my note", "更新我的笔记"));
			};
		case "quiz":
			return async (s) => {
				await s.choose(pick(lang, "It increases", "增大"));
				await s.click(submit);
				// a wrong answer, to show how the agent replies to one
				await s.choose(pick(lang, "Lift keeps increasing", "升力继续增大"));
				await s.click(submit);
				await s.click(keep);
			};
		case "agent":
			return async (s) => {
				await s.choose(pick(lang, "Both, and explain", "两种都写"));
				await s.click(submit);
				await s.click(keep);
			};
		case "collect":
			return async (s) => {
				await s.choose(pick(lang, "Angle of attack —", "迎角——机翼"));
				await s.choose(pick(lang, "Stall —", "失速——"));
				await s.click(submit);
				await s.click(L("apply change", "应用修改"));
				await s.click(keep);
			};
	}
}

/** The learner's moves on an explanation. */
export const glossMoves = (explain: string) => async (s: Steps) => {
	await s.wait(800);
	await s.click(explain);
	await s.click(L("deeper", "更深入"));
	await s.click(L("keep in note", "留在笔记里"));
};
