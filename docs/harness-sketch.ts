// LDoc AI 하네스의 타입과 시그니처. 구현 없음. 설계는 harness.md.
// 읽는 순서: 1 값의 종류 → 2 가리키기 → 3 턴 → 4 도구 → 5 프로세스 경계 → 6 턴 결정 → 7 배선 → 8 측정.

// 코어에서 ts-rs로 생성되는 기존 타입. 저장소의 src/bindings/*.ts에 파일 하나씩 있다.
import type { Answer } from "../src/bindings/Answer";
import type { DocSummary } from "../src/bindings/DocSummary";
import type { Field } from "../src/bindings/Field";
import type { FieldError } from "../src/bindings/FieldError";

// ───────────────────────── 1. 값의 종류 ─────────────────────────

type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type DocId = Brand<string, "DocId">; // 코어 catalog()의 id
export type GuideId = Brand<string, "GuideId">; // "doc-125"
export type FieldId = Brand<string, "FieldId">;
export type TurnId = Brand<string, "TurnId">;

/** Rust의 mask()만 만든다. 하네스 프로세스가 받는 사용자 글은 전부 이 타입이다. */
export type MaskedText = Brand<string, "MaskedText">;
/** 가린 자리의 이름. 예: "⟦인물1⟧". 원문과의 대응표는 Rust 밖으로 나가지 않는다. */
export type Placeholder = Brand<string, "Placeholder">;
/** 템플릿 자리 이름. 예: "balance", "creditor.name". 값은 코어의 Facts만 가진다. */
export type SlotName = Brand<string, "SlotName">;
/** 자리 이름만 들어 있고 숫자, 한글 수사, 조문 번호, 제어 구문이 없는 글. 코어 check_prose가 통과시킨 것만. */
export type CheckedProse = Brand<string, "CheckedProse">;
/** 성공한 법령 조회 결과 하나의 이름. 예: "S1". 실패한 조회에는 발급되지 않는다. */
export type SourceHandle = Brand<string, "SourceHandle">;

// 코어에 추가되는 타입 (Rust에서 정의하고 ts-rs로 생성).

/** pii인 필드의 값은 모델에게 가지 않는다. 대화로 채우지 않고 양식에서만 받는다. */
export type Sensitivity = "public" | "pii";

/** computed: 코어가 양식과 계산을 가짐. template_only: 가이드 템플릿과 자리만 있고 계산이 없음. listed_only: 추천과 설명만 되고 초안은 만들지 않음. */
export type Coverage = "computed" | "compiled" | "blank";

export type Review = { state: "unreviewed" } | { state: "reviewed"; by: string; on: string };

export type DocEntry = DocSummary & { guide: GuideId; coverage: Coverage; review: Review };

/** 모델에게 보여 주는 필드. 값은 없다. */
export type FieldSpec = Pick<Field, "id" | "label" | "help" | "kind"> & { sensitivity: Sensitivity };

export type Slot = {
  name: SlotName;
  kind: "text" | "money" | "date" | "percent" | "count";
  /** 모델이 문장을 쓸 때 읽는 설명. 예: "청구할 잔액". */
  label: string;
};

export type MaskCategory = "person" | "organization" | "resident_no" | "business_no" | "phone" | "address" | "account" | "plate";

/** 화면이 승인 전에 보여 주는 것. 사용자는 낱말을 눌러 더 가릴 수 있다. */
export type MaskPreview = {
  text_id: string;
  masked: MaskedText;
  found: { placeholder: Placeholder; category: MaskCategory; by: "answers" | "pattern" | "user" }[];
};

// ───────────────────────── 2. 가리키기 ─────────────────────────
// 모델은 값을 쓰지 않는다. 선택지를 고르거나, 받은 글의 한 부분을 가리킨다. 값은 코어가 읽는다.
// 자유롭게 값을 적는 갈래가 없다는 것이 이 타입의 요점이다.

export type Pointer =
  | { by: "option"; value: string } // 그 필드의 선택지 중 하나
  | { by: "quote"; text: string; occurrence?: number } // MaskedText의 부분 문자열, 여러 번 나오면 몇 번째인지
  | { by: "placeholder"; token: Placeholder }; // 가려진 이름이나 주소 그 자체

export type ProposedAnswer = { field: FieldId; pointer: Pointer };

/** 코어가 Pointer를 풀어 읽은 결과. 양식에 "후보"로 뜨고 사용자가 확정해야 답이 된다. */
export type Candidate =
  | { field: FieldId; status: "readable"; value: Answer; quoted: string; note?: "year_assumed" }
  | {
      field: FieldId;
      status: "rejected";
      reason: "field_not_offered" | "not_a_choice" | "quote_not_in_text" | "quote_ambiguous" | "value_unreadable";
    };

// ───────────────────────── 3. 턴 ─────────────────────────
// 턴 하나는 요청 하나다. 하네스 프로세스는 턴 사이에 아무것도 기억하지 않는다.
// 같은 TurnRequest를 다시 넣으면 같은 일을 다시 시킬 수 있고, 이것이 단위 업무 측정의 입력이 된다.

export type TurnKind = "recommend" | "fill" | "explain" | "compose" | "research";

type TurnBase<K extends TurnKind> = { kind: K; id: TurnId; model: string };

export type TurnRequest =
  | (TurnBase<"recommend"> & { situation: MaskedText; catalog: Pick<DocEntry, "id" | "title" | "category" | "coverage">[] })
  | (TurnBase<"fill"> & { doc: DocId; text: MaskedText; fields: FieldSpec[] })
  | (TurnBase<"explain"> & { doc: DocId; guide: GuideId; question: MaskedText; about?: FieldSpec })
  | (TurnBase<"compose"> & { doc: DocId; guide: GuideId; section: string; slots: Slot[]; story: MaskedText; lint_errors?: ProseProblem[] })
  | (TurnBase<"research"> & { question: MaskedText; doc?: DocId });

/** 모델이 종료 도구에 넣은 인자 그대로. 아직 아무것도 받아들여지지 않았다. */
export type TurnProposal =
  | { kind: "recommend"; picks: { doc: DocId; reason: string }[]; ask?: string }
  | { kind: "fill"; answers: ProposedAnswer[] }
  | { kind: "explain"; text: string; guide_refs: GuideRef[] }
  | { kind: "compose"; section: string; text: string }
  | { kind: "research"; text: string; sources: SourceHandle[] };

export type TurnFailure =
  | { why: "no_terminal_call" | "schema" | "cancelled" | "stream_incomplete" }
  | { why: "usage_limit" } // subscription_sharing_usage_limit_exceeded
  | { why: "unavailable"; retry_after_ms: number } // subscription_sharing_usage_unavailable 등 503
  | { why: "sign_in_again" } // refresh_token_expired, invalid_grant, subscription_sharing_invalid_user
  | { why: "unsupported"; param: string | null }; // subscription_sharing_unsupported_capability

export type TurnResult = { id: TurnId; ledger: LedgerEntry[] } & ({ ok: true; proposal: TurnProposal } | { ok: false; failure: TurnFailure });

/** Rust가 TurnProposal을 검사한 뒤 화면에 주는 것. 화면은 이것만 본다. */
export type TurnOutcome =
  | { kind: "recommend"; picks: { doc: DocEntry; reason: CheckedProse }[]; ask?: CheckedProse }
  | { kind: "fill"; candidates: Candidate[] }
  | { kind: "explain"; text: CheckedProse; excerpts: GuideExcerpt[] }
  | { kind: "compose"; section: string; text: CheckedProse } // 값은 코어 render가 채움
  | { kind: "research"; text: CheckedProse; sources: SourceCard[] }
  | { kind: "not_confirmed"; message: string } // 성공한 조회가 없을 때 코드가 쓰는 정해진 문장
  | { kind: "failed"; failure: TurnFailure };

export type ProseProblem = { kind: "digit" | "korean_numeral" | "article_number" | "control_syntax" | "unknown_slot"; at: number };

/** 턴 종류마다 하나. 하네스 프로세스 안의 표. 턴 제어의 전부가 여기에 있다. */
export type TurnSpec<K extends TurnKind> = {
  kind: K;
  /** 이 턴의 지시문. 요청의 instructions 필드로 간다. */
  instructions: (request: Extract<TurnRequest, { kind: K }>) => string;
  /** 이 턴에서 요청에 정의되는 도구 전부. 표에 없는 도구는 모델에게 존재하지 않는다. */
  tools: ToolName[];
  /** 모델이 이것을 부르면 턴이 끝난다. */
  terminal: ToolName;
  max_steps: number;
  /** 마지막 스텝에서는 terminal을 강제한다. */
  tool_choice: (step: number, max_steps: number) => "required" | { type: "tool"; toolName: ToolName };
  // 추론 강도는 넣지 않는다. 이 경로가 받는지 확인되지 않았다.
};

export declare const TURN_SPECS: { [K in TurnKind]: TurnSpec<K> };

/** 하네스 프로세스의 입구. Mastra agent.stream()을 TurnSpec대로 한 번 돌린다. */
export declare function runTurn(request: TurnRequest, deps: { core: CorePort; wire: Wire; signal: AbortSignal }): Promise<TurnResult>;

// ───────────────────────── 4. 도구 ─────────────────────────
// 전부 하네스 프로세스 안에서 도는 Mastra createTool이다. law_*만 안에서 korean-law-mcp를 부른다.

export type ToolName = "propose_documents" | "propose_answers" | "submit_prose" | "answer" | "guide_section" | "law_search" | "law_article";

export type GuideSection = "purpose" | "before_drafting" | "collecting" | "checklist" | "template" | "after_drafting";
export type GuideRef = { guide: GuideId; section: GuideSection; step?: number };
/** 가이드 원문 발췌. 화면은 발췌 속 숫자에 "확인되지 않은 수치" 표시를 붙인다. */
export type GuideExcerpt = GuideRef & { text: string };

export type ToolIO = {
  // 종료 도구. 실행 결과가 없고, 인자가 곧 TurnProposal이다.
  propose_documents: { input: { picks: { doc: DocId; reason: string }[]; ask?: string }; output: never };
  propose_answers: { input: { answers: ProposedAnswer[] }; output: never };
  submit_prose: { input: { section: string; text: string }; output: never };
  answer: { input: { text: string; sources: SourceHandle[]; guide_refs: GuideRef[] }; output: never };
  // 읽기 도구.
  guide_section: { input: GuideRef; output: { text: string; truncated: boolean } };
  law_search: {
    input: { query: string; in: "statute" | "decision" };
    output: { ok: true; source: SourceHandle; hits: { ref: string; title: string }[] } | { ok: false; reason: "refused_query" | "quota" | "unreachable" };
  };
  law_article: {
    input: { ref: string; article?: string };
    output: { ok: true; source: SourceHandle; text: string; truncated: boolean } | { ok: false; reason: "empty_body" | "quota" | "unreachable" };
  };
};

/** 화면이 인용을 그릴 때 쓰는 것. 조문 이름과 본문은 모델의 글이 아니라 저장된 조회 결과에서 온다. */
export type SourceCard = { source: SourceHandle; title: string; article: string | null; text: string; fetched_at: string };

/** 모델 없이 코드가 korean-law-mcp를 부르는 경로. 관리자용 명령줄 `ldoc-harness verify-tables`가 쓴다. */
export type TableCheck = { table: string; statute: string; article: string; expected_sha256: string };
export declare function verifyTables(checks: TableCheck[], law: LawClient): Promise<{ table: string; result: "same" | "changed" | "unreachable" }[]>;
export interface LawClient {
  searchLaw(query: string): Promise<unknown>;
  getLawText(ref: string, article?: string): Promise<unknown>;
}

// ───────────────────────── 5. 프로세스 경계 ─────────────────────────
// 화면(웹뷰) ⇄ Rust 셸: Tauri 명령.  Rust 셸 ⇄ 하네스 프로세스: 표준 입출력 위의 JSON-RPC 2.0, 한 줄에 메시지 하나.

/** Rust 셸이 하네스 프로세스에 시키는 것. */
export interface HarnessPort {
  health(): Promise<{ mastra: string; uptime_ms: number }>;
  runTurn(request: TurnRequest): Promise<TurnResult>;
  cancel(id: TurnId): Promise<void>;
}

/** 하네스가 댈 수 있는 목적지. 주소는 Rust가 정한다. */
export type NetTarget = "openai.responses" | "openai.models" | "law.mcp";

export type NetRequest = {
  request_id: string;
  turn: TurnId | null;
  target: NetTarget;
  method: "GET" | "POST";
  /** Authorization과 apikey는 Rust가 버리고 자기 것을 붙인다. */
  headers: Record<string, string>;
  body: string | null;
};

export type NetHead = { request_id: string; status: number; headers: Record<string, string> };

/** 나가는 문이 막았을 때 무엇이 걸렸는지. */
export type Leak = { kind: MaskCategory | "unapproved_text"; at: number; length: number };

/** NetHead 뒤에 Rust가 하네스로 보내는 알림. 스트림 본문이 조각으로 온다. */
export type NetNotification =
  | { method: "net.chunk"; params: { request_id: string; data: string } }
  | { method: "net.end"; params: { request_id: string } }
  | { method: "net.blocked"; params: { request_id: string; leaks: Leak[] } };

/** 하네스 프로세스가 Rust 셸에 묻는 것. 평가에서는 코어를 감싼 작은 실행 파일이 같은 역할을 한다. */
export interface CorePort {
  /** 기기 밖으로 나가는 유일한 길. Rust가 토큰이나 법령 키를 붙이고, 본문을 검사하고, 기록한 뒤 보낸다. */
  netFetch(request: NetRequest): Promise<NetHead>;
  /** 성공한 조회만 등록된다. 돌려받은 이름만 answer.sources에 쓸 수 있다. */
  sourcePut(turn: TurnId, entry: Omit<SourceCard, "source">): Promise<SourceHandle>;
  progress(turn: TurnId, step: number, doing: "thinking" | ToolName): void;
}

/** Rust 코어에 추가되는 함수. Tauri 명령으로도 노출된다. 여기서는 TypeScript 모양으로 적는다. */
export interface CoreAdditions {
  catalog(): DocEntry[];
  /** 지금 보이는 필드 중 답이 없는 것. show_when은 코어가 계산한다. */
  openFields(doc: DocId, answers: Record<string, Answer>): FieldSpec[];
  /** 답에 있는 값(표기 차이 흡수), 번호류 정규식, 사용자가 누른 낱말로 가린다. */
  mask(text: string, answers: Record<string, Answer>, extra: string[]): MaskPreview;
  /** Pointer를 원문에 대고 값을 읽는다. 금액과 날짜는 코어의 해석기가 읽지 못하면 후보가 되지 않는다. */
  resolve(doc: DocId, text_id: string, proposed: ProposedAnswer[]): Candidate[];
  slots(doc: DocId): Slot[];
  checkProse(text: string, allowed: SlotName[]): { ok: true; prose: CheckedProse } | { ok: false; problems: ProseProblem[] };
  /** 답만 검사하고 문서는 만들지 않는다. 지금의 draft()에서 오류 부분만. */
  checkAnswers(doc: DocId, answers: Record<string, Answer>): FieldError[];
}

/** 화면이 부르는 Tauri 명령. 화면은 하네스 프로세스와 직접 말하지 않는다. */
export interface AssistCommands {
  assist_status(): Promise<{ enabled: boolean; signed_in: boolean; models: string[]; paused: TurnFailure | null }>;
  /** 로그인은 Rust가 한다. 창은 사용자의 브라우저에 열리고 토큰은 OS 키체인에 간다. */
  assist_sign_in(): Promise<{ ok: boolean }>;
  assist_sign_out(): Promise<void>;
  assist_preview(text: string, doc: DocId | null, extra_masks: string[]): Promise<MaskPreview>;
  /** 승인된 text_id만 받는다. 승인하지 않은 글은 Rust가 보내기를 거부한다. */
  assist_run(plan: TurnPlan, approved_text_id: string): Promise<TurnOutcome>;
  assist_cancel(id: TurnId): Promise<void>;
  assist_sent(id: TurnId): Promise<{ to: "openai" | "korean-law"; body: string }[]>;
}

// ───────────────────────── 6. 턴 결정 ─────────────────────────
// 다음에 무슨 턴을 돌릴지는 모델이 아니라 이 함수가 정한다. 부작용이 없어 단위 테스트로 검증한다.

export type Surface = "choosing" | { filling: DocId; step: number; field?: FieldId } | { editing: DocId; section?: string };

export type TurnPlan =
  | { kind: "recommend" }
  | { kind: "fill"; doc: DocId }
  | { kind: "explain"; doc: DocId; field?: FieldId }
  | { kind: "compose"; doc: DocId; section: string }
  | { kind: "research"; doc?: DocId };

export type AssistantState = {
  enabled: boolean;
  signed_in: boolean;
  running: TurnId | null;
  /** 같은 턴을 고쳐 다시 시킨 횟수. 1을 넘지 않는다. */
  retries: number;
  candidates: Candidate[];
  paused: TurnFailure | null;
};

export type AssistantEvent =
  | { type: "text_entered"; surface: Surface; text: string; intent: "paste" | "question" | "situation" | "write" }
  | { type: "preview_approved"; text_id: string }
  | { type: "outcome"; outcome: TurnOutcome }
  | { type: "candidate_decided"; field: FieldId; accepted: boolean }
  | { type: "cancelled" };

export type Effect =
  | { do: "show_preview"; plan: TurnPlan }
  | { do: "run"; plan: TurnPlan; text_id: string }
  | { do: "show_candidates"; candidates: Candidate[] }
  | { do: "focus_field"; field: FieldId } // 다음 질문은 양식의 다음 빈 필드다. 모델에게 묻지 않는다.
  | { do: "use_form_only"; reason: string }; // AI 없이 계속. 양식은 언제나 된다.

export declare function plan(state: AssistantState, event: AssistantEvent): { state: AssistantState; effects: Effect[] };

// ───────────────────────── 7. 배선 ─────────────────────────
// Mastra가 만든 요청이 OpenAI에 닿기 전에 지나는 한 곳. AI SDK createOpenAI의 fetch 자리에 끼운다.

/** AI SDK createOpenAI와 MCPClient의 fetch 자리에 끼우는 것. 요청을 고쳐 CorePort.netFetch로 넘긴다. */
export type Wire = {
  fetch(target: NetTarget): typeof fetch;
};

/** 이 경로가 요구하는 모양으로 고친다. store=false, stream=true, 금지 필드 제거, system 역할을 developer로. 실계정이 요구하면 도구를 네임스페이스로. */
export declare function shapeRequest(body: Record<string, unknown>): Record<string, unknown>;

export declare const OMITTED_FIELDS: readonly [
  "background", "conversation", "max_output_tokens", "max_tool_calls", "metadata", "moderation", "multi_agent", "prompt",
  "prompt_cache_retention", "safety_identifier", "temperature", "top_logprobs", "top_p", "truncation", "user", "previous_response_id",
];

export declare function makeWire(deps: { core: CorePort; turn: TurnId }): Wire;

// ───────────────────────── 8. 측정 ─────────────────────────

/** 실계정 응답에 사용량이 담기는지는 확인되지 않았다. 없으면 null이고 bytes로 비교한다. */
export type Usage = { input_tokens: number; output_tokens: number; cached_input_tokens: number | null; reasoning_tokens: number | null };

/** 모델 요청 하나에 한 줄. */
export type LedgerEntry = {
  turn: TurnId;
  kind: TurnKind | "vanilla";
  arm: Arm;
  step: number;
  request_bytes: number;
  response_bytes: number;
  usage: Usage | null;
  ms: number;
  tool_calls: ToolName[] | string[];
  ended: "completed" | "failed" | "incomplete";
};

/** 측정의 판. V는 스킬 그대로, C3이 이 설계. */
export type Arm = "V" | "C1" | "C2" | "C3";

export type UnitTask = "recommend" | "extract_answers" | "calculate" | "write_narrative" | "look_up_law" | "look_up_law_failing" | "whole_document";

export type Fixture<Input, Gold> = { id: string; unit: UnitTask; input: Input; gold: Gold };

export type Score = {
  passed: boolean;
  /** 틀린 값이 받아들여진 수. 누락과 따로 센다. */
  wrong_accepted: number;
  missing: number;
  /** 요청 본문에서 발견된 픽스처의 개인정보 문자열 수. 0이어야 한다. */
  pii_leaks: number;
};

export type UnitCost = {
  unit: UnitTask;
  arm: Arm;
  runs: number;
  pass_rate: number;
  requests_per_run: number[]; // 분포를 그대로 둔다. temperature를 고정할 수 없기 때문이다.
  input_tokens_per_run: (number | null)[];
  request_bytes_per_run: number[];
  seconds_per_run: number[];
  wrong_accepted_total: number;
};

/** 바닐라: SKILL.md 전체가 지시문, 도구는 가이드 파일 읽기와 korean-law 10개, 다음 단계는 모델이 정함. */
/** 같은 입력을 한 판으로 돌린다. V, C1, C2는 도구와 지시문만 다르고 C3은 plan()과 runTurn()을 쓴다. */
export declare function runArm<I, G>(arm: Arm, fixture: Fixture<I, G>, deps: { core: CoreAdditions & CorePort; wire: Wire }): Promise<{ result: string | TurnOutcome; ledger: LedgerEntry[] }>;
export declare function score<I, G>(fixture: Fixture<I, G>, result: string | TurnOutcome, sent: string[]): Score;
export declare function summarize(unit: UnitTask, arm: Arm, runs: { score: Score; ledger: LedgerEntry[] }[]): UnitCost;
