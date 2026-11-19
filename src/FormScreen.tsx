// Renders any Form the core returns. Nothing here knows a particular document.

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import type { ISODateString } from "@astryxdesign/core/Calendar";
import { Card } from "@astryxdesign/core/Card";
import { Center } from "@astryxdesign/core/Center";
import { CheckboxList, CheckboxListItem } from "@astryxdesign/core/CheckboxList";
import { DateInput } from "@astryxdesign/core/DateInput";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent, LayoutFooter, LayoutHeader, LayoutPanel } from "@astryxdesign/core/Layout";
import { RadioList, RadioListItem } from "@astryxdesign/core/RadioList";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Stack";
import { Step, Stepper } from "@astryxdesign/core/Stepper";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import type { ReactNode } from "react";
import type { Filling } from "./App";
import type { Readable } from "./AssistPanel";
import type { Answer } from "./bindings/Answer";
import type { Field } from "./bindings/Field";
import type { Answers } from "./ipc";

/** The form column, and the rail and side panel beside it, as in the form-wizard-vertical template. */
const MEASURE = 640;
const PANEL_WIDTH = 300;

/** The field is asked while the answer to its condition's field is, or includes, one of the values. */
export function isShown(field: Field, answers: Answers): boolean {
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
  side,
}: {
  filling: Filling;
  onChange: (filling: Filling) => void;
  onNext: () => void;
  /** The panel beside the form. */
  side: ReactNode;
}) {
  const { doc, form, step, answers, errors, candidates } = filling;
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
  const candidateFor = (id: string) => candidates.find((candidate) => candidate.field === id);
  const without = (taken: Readable) => candidates.filter((candidate) => candidate !== taken);
  const accept = (field: Field, taken: Readable) =>
    onChange({
      ...filling,
      answers: { ...answers, [field.id]: merged(field, answers[field.id], taken.value) },
      candidates: without(taken),
      errors: errors.filter((error) => error.field !== field.id),
    });
  const dismiss = (taken: Readable) => onChange({ ...filling, candidates: without(taken) });

  return (
    <Layout
      height="fill"
      padding={4}
      header={
        <LayoutHeader hasDivider>
          <Text type="label">{doc.title}</Text>
        </LayoutHeader>
      }
      start={
        <LayoutPanel width={PANEL_WIDTH} role="navigation" label="작성 단계">
          <Stepper activeStep={step} orientation="vertical" onStepClick={goTo} label="작성 단계">
            {form.steps.map((candidate, index) => {
              const invalid = candidate.fields.some((field) => errorOf(field.id) !== undefined);
              const waiting = candidate.fields.filter(
                (field) => isShown(field, answers) && candidateFor(field.id),
              ).length;
              return (
                <Step
                  key={candidate.title}
                  step={index}
                  label={candidate.title}
                  description={
                    invalid ? "확인이 필요한 항목이 있습니다." : waiting > 0 ? `후보 ${waiting}개` : undefined
                  }
                  status={invalid ? "error" : undefined}
                  indicator={invalid ? <Icon icon="error" size="sm" /> : "number"}
                />
              );
            })}
          </Stepper>
        </LayoutPanel>
      }
      end={
        <LayoutPanel width={PANEL_WIDTH} hasDivider role="complementary" label="붙여 넣은 글로 채우기">
          {side}
        </LayoutPanel>
      }
      content={
        <LayoutContent>
          <Center axis="horizontal">
            <VStack gap={6} width="100%" maxWidth={MEASURE} data-step={step} data-steps={form.steps.length}>
              <VStack gap={1}>
                <Heading level={1}>{current.title}</Heading>
                <Text type="supporting" color="secondary">
                  {step + 1} / {form.steps.length} 단계. "선택 사항" 표시가 없는 항목은 꼭 답해야 합니다.
                </Text>
              </VStack>

              {unplaced.length > 0 && (
                <Banner
                  status="error"
                  title="입력을 확인해 주세요"
                  description={unplaced.map((error) => error.message).join(" ")}
                />
              )}

              <FormLayout defaultOptionality="required">
                {shown.map((field) => {
                  const candidate = candidateFor(field.id);
                  return (
                    <VStack key={field.id} gap={2} data-field={field.id} data-kind={field.kind.type}>
                      <FieldInput
                        field={field}
                        answer={answers[field.id]}
                        error={errorOf(field.id)}
                        onAnswer={(value) => answer(field.id, value)}
                      />
                      {candidate && (
                        <CandidateNote
                          field={field}
                          candidate={candidate}
                          onAccept={() => accept(field, candidate)}
                          onDismiss={() => dismiss(candidate)}
                        />
                      )}
                    </VStack>
                  );
                })}
              </FormLayout>
            </VStack>
          </Center>
        </LayoutContent>
      }
      footer={
        <LayoutFooter hasDivider>
          <Center axis="horizontal">
            <HStack gap={3} vAlign="center" width="100%" maxWidth={MEASURE}>
              <Button label="이전" variant="secondary" isDisabled={step === 0} onClick={() => goTo(step - 1)} />
              <StackItem size="fill" />
              <Button label={last ? "초안 만들기" : "다음"} variant="primary" data-action="next" onClick={onNext} />
            </HStack>
          </Center>
        </LayoutFooter>
      }
    />
  );
}

/** A multi-choice candidate adds to what is already ticked; any other replaces the answer. */
function merged(field: Field, current: Answer | undefined, value: Answer): Answer {
  if (field.kind.type !== "multi_choice" || !Array.isArray(value) || !Array.isArray(current)) return value;
  return field.kind.options.map((option) => option.value).filter((key) => current.includes(key) || value.includes(key));
}

/** What a candidate would answer, as the field shows it: choices by their label. */
function shownValue(field: Field, value: Answer): string {
  const keys = typeof value === "string" ? [value] : value;
  const kind = field.kind;
  if (kind.type !== "choice" && kind.type !== "multi_choice") return keys.join(", ");
  return keys.map((key) => kind.options.find((option) => option.value === key)?.label ?? key).join(", ");
}

function CandidateNote({
  field,
  candidate,
  onAccept,
  onDismiss,
}: {
  field: Field;
  candidate: Readable;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <Card variant="blue" padding={3} data-candidate={field.id}>
      <VStack gap={2}>
        <VStack gap={0.5}>
          <Text type="supporting">붙여 넣은 글에서 찾은 후보</Text>
          <Text type="body" weight="semibold">
            {shownValue(field, candidate.value)}
          </Text>
          <Text type="supporting" color="secondary">
            근거: “{candidate.quoted}”
          </Text>
        </VStack>
        <HStack gap={2}>
          <Button label="받아들이기" size="sm" data-action="accept" onClick={onAccept} />
          <Button label="버리기" size="sm" variant="ghost" data-action="dismiss" onClick={onDismiss} />
        </HStack>
      </VStack>
    </Card>
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
  const text = typeof answer === "string" ? answer : "";
  const picked = Array.isArray(answer) ? answer : [];
  const common = {
    label: field.label,
    description: field.help ?? undefined,
    isOptional: !field.required,
    status: error ? { type: "error" as const, message: error } : undefined,
  };
  const kind = field.kind;

  switch (kind.type) {
    case "text":
      return <TextInput {...common} value={text} onChange={onAnswer} />;
    case "long_text":
      return <TextArea {...common} rows={4} value={text} onChange={onAnswer} />;
    case "money":
      return <TextInput {...common} inputMode="numeric" placeholder="원 단위, 예: 7,000,000" value={text} onChange={onAnswer} />;
    case "date":
      return (
        <DateInput
          {...common}
          value={text ? (text as ISODateString) : undefined}
          onChange={(value) => onAnswer(value ?? "")}
        />
      );
    case "choice":
      return (
        <RadioList {...common} value={text} onChange={onAnswer}>
          {kind.options.map((option) => (
            <RadioListItem key={option.value} value={option.value} label={option.label} data-value={option.value} />
          ))}
        </RadioList>
      );
    case "multi_choice":
      return (
        <CheckboxList
          {...common}
          value={picked}
          onChange={(values) =>
            onAnswer(kind.options.map((option) => option.value).filter((value) => values.includes(value)))
          }
        >
          {kind.options.map((option) => (
            <CheckboxListItem key={option.value} value={option.value} label={option.label} data-value={option.value} />
          ))}
        </CheckboxList>
      );
  }
}
