// Renders any Form the core returns. Nothing here knows a particular document.

import type { Filling } from "./App";
import type { Answer } from "./bindings/Answer";
import type { Field } from "./bindings/Field";
import type { Answers } from "./ipc";

/** The field is asked while the answer to its condition's field is, or includes, one of the values. */
function isShown(field: Field, answers: Answers): boolean {
  const condition = field.show_when;
  if (!condition) return true;
  const answer = answers[condition.field] ?? [];
  const given = typeof answer === "string" ? [answer] : answer;
  return given.some((value) => condition.is_one_of.includes(value));
}

export function FormScreen({
  filling,
  onChange,
  onNext,
}: {
  filling: Filling;
  onChange: (filling: Filling) => void;
  onNext: () => void;
}) {
  const { form, step, answers, errors } = filling;
  const current = form.steps[step]!;
  const shown = current.fields.filter((field) => isShown(field, answers));
  const unplaced = errors.filter(
    (error) => !form.steps.some((candidate) => candidate.fields.some((field) => field.id === error.field)),
  );
  const last = step === form.steps.length - 1;
  const errorOf = (id: string) => errors.find((error) => error.field === id)?.message;

  const answer = (id: string, value: Answer) =>
    onChange({ ...filling, answers: { ...answers, [id]: value }, errors: errors.filter((error) => error.field !== id) });
  const goTo = (index: number) => onChange({ ...filling, step: index });

  return (
    <div className="filling">
      <nav className="stepper" aria-label="작성 단계">
        {form.steps.map((candidate, index) => {
          const invalid = candidate.fields.some((field) => errorOf(field.id) !== undefined);
          return (
            <button
              key={candidate.title}
              type="button"
              className="stepper-item"
              aria-current={index === step ? "step" : undefined}
              data-invalid={invalid || undefined}
              onClick={() => goTo(index)}
            >
              <span className="stepper-num">{index + 1}</span>
              <span className="stepper-title">{candidate.title}</span>
              {invalid && <span className="stepper-flag">확인 필요</span>}
            </button>
          );
        })}
      </nav>

      <form
        className="step-card"
        data-step={step}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onNext();
        }}
      >
        <header className="step-head">
          <p className="eyebrow">
            {step + 1} / {form.steps.length} 단계
          </p>
          <h1>{current.title}</h1>
          <p className="legend">
            <span className="required">*</span> 표시는 꼭 답해야 하는 항목입니다.
          </p>
        </header>

        {unplaced.length > 0 && (
          <div className="problem" role="alert">
            {unplaced.map((error) => (
              <p key={`${error.field}:${error.message}`}>{error.message}</p>
            ))}
          </div>
        )}

        <div className="fields">
          {shown.map((field) => (
            <FieldInput
              key={field.id}
              field={field}
              answer={answers[field.id]}
              error={errorOf(field.id)}
              onAnswer={(value) => answer(field.id, value)}
            />
          ))}
        </div>

        <footer className="step-foot">
          <button type="button" className="secondary" disabled={step === 0} onClick={() => goTo(step - 1)}>
            이전
          </button>
          <button type="submit" className="primary">
            {last ? "초안 만들기" : "다음"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function FieldInput({
  field,
  answer,
  error,
  onAnswer,
}: {
  field: Field;
  answer: Answer | undefined;
  error: string | undefined;
  onAnswer: (value: Answer) => void;
}) {
  const id = `field-${field.id}`;
  const text = typeof answer === "string" ? answer : "";
  const picked = Array.isArray(answer) ? answer : [];
  const described = [field.help && `${id}-help`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  const common = { id, "aria-invalid": error ? true : undefined, "aria-describedby": described };
  const kind = field.kind;

  const label = (
    <>
      {field.label}
      {field.required ? (
        <span className="required" aria-label="필수">
          *
        </span>
      ) : (
        <span className="optional">선택</span>
      )}
    </>
  );

  const control = (() => {
    switch (kind.type) {
      case "text":
        return <input {...common} type="text" value={text} onChange={(event) => onAnswer(event.target.value)} />;
      case "long_text":
        return <textarea {...common} rows={4} value={text} onChange={(event) => onAnswer(event.target.value)} />;
      case "money":
        return (
          <div className="money">
            <input
              {...common}
              type="text"
              inputMode="numeric"
              placeholder="0"
              value={text}
              onChange={(event) => onAnswer(event.target.value)}
            />
            <span>원</span>
          </div>
        );
      case "date":
        return <input {...common} type="date" value={text} onChange={(event) => onAnswer(event.target.value)} />;
      case "choice":
        return (
          <div className="options" role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={described}>
            {kind.options.map((option) => (
              <label key={option.value} className="option" data-value={option.value}>
                <input
                  type="radio"
                  name={field.id}
                  value={option.value}
                  checked={text === option.value}
                  onChange={() => onAnswer(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        );
      case "multi_choice":
        return (
          <div className="options" role="group" aria-labelledby={`${id}-label`} aria-describedby={described}>
            {kind.options.map((option) => (
              <label key={option.value} className="option" data-value={option.value}>
                <input
                  type="checkbox"
                  value={option.value}
                  checked={picked.includes(option.value)}
                  onChange={(event) =>
                    onAnswer(
                      kind.options
                        .map((candidate) => candidate.value)
                        .filter((value) => (value === option.value ? event.target.checked : picked.includes(value))),
                    )
                  }
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        );
    }
  })();

  const grouped = kind.type === "choice" || kind.type === "multi_choice";
  return (
    <div className="field" data-field={field.id} data-kind={kind.type} data-invalid={error ? true : undefined}>
      {grouped ? (
        <span className="field-label" id={`${id}-label`}>
          {label}
        </span>
      ) : (
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
      )}
      {field.help && (
        <p className="help" id={`${id}-help`}>
          {field.help}
        </p>
      )}
      {control}
      {error && (
        <p className="error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
