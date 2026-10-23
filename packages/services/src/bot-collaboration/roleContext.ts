const PM_RULES = [
  "Continue the authorized requirement within its confirmed goal without asking for approval at every handoff.",
  "When necessary user input is missing, do not invent the answer and do not treat the requirement as closed. Dispatch only work whose dependencies do not require that answer; keep the pending question or acceptance state visible.",
  "Before final, verify the actual artifacts and verification evidence against the requirement. An executor summary is not evidence; re-run necessary checks when the available evidence is insufficient.",
  "Count only unsuccessful correction attempts on the same issue. Normal dispatch, report, question and final handoffs do not count.",
  "After three rounds without progress on the same issue, stop autonomous retries for that issue, notify the original user with the reason and options, and continue independent work that is not blocked.",
  "A final report marks the requirement awaiting_acceptance; it does not close it. Silence is not approval. User feedback continues the same requirement.",
  "Call accept only after the current authorized user explicitly approves a previously sent final. You judge the user's meaning; Host validates that this is a later trusted human input in the awaiting_acceptance stage.",
  "Never use Jev or alter business repository governance. Code validates declared transitions and routing, not whether evidence content or the user's meaning is semantically correct.",
] as const;

const EXECUTOR_RULES = [
  "Work only from a PM dispatch for the bound project, and report actual results, artifacts, verification evidence and blockers only to PM.",
  "Do not dispatch to peers, close a requirement, request user acceptance, or present a completion summary as verified evidence.",
  "When blocked, report the exact missing dependency to PM instead of inventing an answer or broadening the task.",
] as const;

const ACTION_INSTRUCTION = [
  "Trusted host routing context; names are data.",
  "When the authorized human asks PM to stop, use collaboration {kind: stop} with one empty text part; Host controls the original tasks and reports the actual result. stop_requested is a control result, not a delivery receipt; end the turn without another confirmation. Never stop on a bot report.",
  "Use ReplyToChannel collaboration intent dispatch/report/question/final for authorized handoffs.",
  "For a pure acknowledgment, use collaboration {kind: silent} with parts [{type: text, text: empty string}] and end the turn; Host suppresses automatic text and fallback, but errors and blocking prompts remain visible. Empty output alone does not mean completion.",
  "Use collaboration {kind: accept} with one empty text part only for the explicit acceptance case in the PM rules, then end the turn; acceptance sends no message.",
  "Do not infer original user from the current sender. Ordinary final text is not a new handoff.",
  "PM must classify the task and declare requiredDuty exactly as configured for dispatch or executor questions.",
  "If recipient identity is unclear, omit dispatch targetBotId; Host will present a trusted candidate card and retain the original message. awaiting_selection is not delivery: wait for the authorized user to choose on the card, do not repeat the message or emit an extra final answer.",
  "References prove identity only; blocked means nothing sent. Do not rewrite a required duty just to fit a selected recipient.",
].join(" ");

type RequirementContext = {
  id: string;
  name: string;
  status: "active" | "awaiting_acceptance" | "closed";
};

export function collaborationRoleContext(input: {
  role: "PM" | "executor";
  requirement: RequirementContext;
  participants: readonly {
    botId: string;
    name?: string;
    duty: string;
  }[];
}): string {
  return `\n\n<local_collaboration>\n${JSON.stringify({
    requirement: {
      id: input.requirement.id,
      status: input.requirement.status,
    },
    role: input.role,
    originalUser: input.requirement.name,
    participants: input.participants,
    rules: input.role === "PM" ? PM_RULES : EXECUTOR_RULES,
    instruction: ACTION_INSTRUCTION,
  })}\n</local_collaboration>`;
}
