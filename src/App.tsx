import { useEffect, useState } from "react";
import icon from "../assets/icon.svg";
import type { DocSummary } from "./bindings/DocSummary";
import type { Draft } from "./bindings/Draft";
import type { FieldError } from "./bindings/FieldError";
import type { Form } from "./bindings/Form";
import { EditorScreen } from "./EditorScreen";
import { FormScreen } from "./FormScreen";
import * as ipc from "./ipc";

/** A document being answered. Kept while editing so the person can return to it. */
export type Filling = {
  doc: DocSummary;
  form: Form;
  step: number;
  answers: ipc.Answers;
  errors: FieldError[];
};

type Screen =
  | { kind: "loading" }
  | { kind: "choosing"; catalog: DocSummary[] }
  | { kind: "filling"; filling: Filling }
  | { kind: "editing"; filling: Filling; draft: Draft };

const PHASES: { kind: Screen["kind"]; label: string }[] = [
  { kind: "choosing", label: "문서 선택" },
  { kind: "filling", label: "내용 입력" },
  { kind: "editing", label: "초안 편집" },
];

/**
 * Where asking the core for a draft leads. Leaving a step only needs that
 * step's answers to pass; the last step needs all of them, and on failure
 * goes to the first step with a problem.
 */
function afterDraft(filling: Filling, result: ipc.DraftResult): Screen {
  const { form, step } = filling;
  const last = step === form.steps.length - 1;
  if (result.ok && last) {
    return { kind: "editing", filling: { ...filling, errors: [] }, draft: result.draft };
  }
  const errors = result.ok
    ? []
    : result.error.type === "invalid_fields"
      ? result.error.errors
      : [{ field: "", message: "이 문서를 찾지 못했습니다." }];
  const errorsIn = (index: number) =>
    errors.filter((error) => form.steps[index]!.fields.some((field) => field.id === error.field));
  if (!last) {
    const here = errorsIn(step);
    return {
      kind: "filling",
      filling: here.length > 0 ? { ...filling, errors: here } : { ...filling, step: step + 1, errors: [] },
    };
  }
  const first = form.steps.findIndex((_, index) => errorsIn(index).length > 0);
  return { kind: "filling", filling: { ...filling, errors, step: first === -1 ? step : first } };
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [problem, setProblem] = useState<string | null>(null);
  const report = (error: unknown) => setProblem(String(error));

  useEffect(() => {
    ipc.catalog().then((catalog) => setScreen({ kind: "choosing", catalog }), report);
  }, []);

  async function start(doc: DocSummary) {
    const form = await ipc.form(doc.id);
    if (form) setScreen({ kind: "filling", filling: { doc, form, step: 0, answers: {}, errors: [] } });
    else setProblem(`${doc.title} 양식을 찾지 못했습니다.`);
  }

  async function next(filling: Filling) {
    setScreen(afterDraft(filling, await ipc.draft(filling.doc.id, filling.answers)));
  }

  const doc = screen.kind === "filling" || screen.kind === "editing" ? screen.filling.doc : null;
  const phase = PHASES.findIndex((candidate) => candidate.kind === screen.kind);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src={icon} alt="" width={28} height={28} />
          <span>LDoc</span>
        </div>
        {doc && <div className="topbar-title">{doc.title}</div>}
        <ol className="phases">
          {PHASES.map((candidate, index) => (
            <li
              key={candidate.kind}
              className={index === phase ? "current" : index < phase ? "done" : undefined}
            >
              <span className="phase-num">{index + 1}</span>
              {candidate.label}
            </li>
          ))}
        </ol>
      </header>

      {problem && (
        <div className="problem" role="alert">
          <span>{problem}</span>
          <button type="button" className="link" onClick={() => setProblem(null)}>
            닫기
          </button>
        </div>
      )}

      <main className="main">
        {screen.kind === "loading" && <p className="loading">불러오는 중…</p>}

        {screen.kind === "choosing" && (
          <section className="choosing">
            <h1>어떤 문서를 작성할까요?</h1>
            <p className="lead">질문에 답하면 비용과 문안을 계산한 초안을 만들어 드립니다.</p>
            <div className="catalog">
              {screen.catalog.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="catalog-card"
                  data-doc={item.id}
                  onClick={() => start(item).catch(report)}
                >
                  <span className="badge">{item.category}</span>
                  <span className="catalog-title">{item.title}</span>
                  <span className="catalog-action">작성 시작 →</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {screen.kind === "filling" && (
          <FormScreen
            filling={screen.filling}
            onChange={(filling) => setScreen({ kind: "filling", filling })}
            onNext={() => next(screen.filling).catch(report)}
          />
        )}

        {screen.kind === "editing" && (
          <EditorScreen
            title={screen.filling.doc.title}
            draft={screen.draft}
            onBack={() => setScreen({ kind: "filling", filling: screen.filling })}
          />
        )}
      </main>
    </div>
  );
}
