import { AppShell } from "@astryxdesign/core/AppShell";
import { Banner } from "@astryxdesign/core/Banner";
import { Center } from "@astryxdesign/core/Center";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { Grid } from "@astryxdesign/core/Grid";
import { InternationalizationProvider } from "@astryxdesign/core/i18n";
import { Layout, LayoutContent, LayoutHeader } from "@astryxdesign/core/Layout";
import koKR from "@astryxdesign/core/locales/ko-KR.generated.js";
import { Spinner } from "@astryxdesign/core/Spinner";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Step, Stepper } from "@astryxdesign/core/Stepper";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Theme } from "@astryxdesign/core/theme";
import { TopNav } from "@astryxdesign/core/TopNav";
import { useEffect, useState } from "react";
import { defaultThemeSlug, themes } from "./astryx-themes";
import type { DocSummary } from "./bindings/DocSummary";
import type { Draft } from "./bindings/Draft";
import type { FieldError } from "./bindings/FieldError";
import type { Form } from "./bindings/Form";
import { AssistPanel } from "./AssistPanel";
import { type Filled, type Readable, apply } from "./candidates";
import { Disclaimer } from "./Disclaimer";
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
  /** Answers read from pasted text that the person decides on: they disagree, or their field was already answered. */
  candidates: Readable[];
  /** Where each answer filled from pasted text came from. */
  filled: Filled;
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

/** The phase stepper's width in the top bar: three labels at the stepper's minimum step width and a little air. */
const PHASES_WIDTH = 420;

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
    if (form) setScreen({ kind: "filling", filling: { doc, form, step: 0, answers: {}, errors: [], candidates: [], filled: {} } });
    else setProblem(`${doc.title} 양식을 찾지 못했습니다.`);
  }

  async function next(filling: Filling) {
    setScreen(afterDraft(filling, await ipc.draft(filling.doc.id, filling.answers)));
  }

  const phase = PHASES.findIndex((candidate) => candidate.kind === screen.kind);

  return (
    <Theme theme={themes[defaultThemeSlug]} mode="light">
      <InternationalizationProvider locale="ko-KR" messages={{ "ko-KR": koKR }}>
        <AppShell
          variant="section"
          banner={
            problem && (
              <Banner
                status="error"
                container="section"
                role="alert"
                title="문제가 생겼습니다"
                description={problem}
                isDismissable
                dismissLabel="오류 알림 닫기"
                onDismiss={() => setProblem(null)}
              />
            )
          }
          topNav={
            <TopNav
              label="LDoc"
              heading={
                <Text type="large" weight="bold">
                  LDoc
                </Text>
              }
              endContent={
                <HStack width={PHASES_WIDTH}>
                  <Stepper activeStep={Math.max(phase, 0)} label="작성 단계" density="compact">
                    {PHASES.map((candidate, index) => (
                      <Step key={candidate.kind} step={index} label={candidate.label} />
                    ))}
                  </Stepper>
                </HStack>
              }
            />
          }
        >
          {screen.kind === "loading" && (
            <Center height="100%">
              <Spinner size="lg" label="불러오는 중" />
            </Center>
          )}

          {screen.kind === "choosing" && <ChoosingScreen catalog={screen.catalog} onStart={(doc) => start(doc).catch(report)} />}

          {screen.kind === "filling" && (
            <FormScreen
              filling={screen.filling}
              onChange={(filling) => setScreen({ kind: "filling", filling })}
              onNext={() => next(screen.filling).catch(report)}
              side={
                <AssistPanel
                  filling={screen.filling}
                  onFill={(readable) =>
                    // Applied to the filling as it is when the turn ends, so an answer typed meanwhile stays.
                    setScreen((current) => {
                      if (current.kind !== "filling") return current;
                      const before = current.filling;
                      const after = apply(before.form, before, readable);
                      const errors = before.errors.filter((error) => after.answers[error.field] === before.answers[error.field]);
                      return { kind: "filling", filling: { ...after, errors } };
                    })
                  }
                />
              }
            />
          )}

          {screen.kind === "editing" && (
            <EditorScreen
              title={screen.filling.doc.title}
              draft={screen.draft}
              onBack={() => setScreen({ kind: "filling", filling: screen.filling })}
            />
          )}
        </AppShell>
      </InternationalizationProvider>
    </Theme>
  );
}

function ChoosingScreen({ catalog, onStart }: { catalog: DocSummary[]; onStart: (doc: DocSummary) => void }) {
  return (
    <Layout
      header={
        <LayoutHeader hasDivider padding={6}>
          <VStack gap={2}>
            <Heading level={1}>어떤 문서를 작성할까요?</Heading>
            <Text type="body" color="secondary">
              질문에 답하면 비용과 문안을 계산한 초안을 만들어 드립니다.
            </Text>
          </VStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent padding={6}>
          <VStack gap={6}>
            <Disclaimer />
            <Grid columns={{ minWidth: 320 }} gap={4}>
              {catalog.map((item) => (
                <ClickableCard key={item.id} label={`${item.title} 작성 시작`} data-doc={item.id} onClick={() => onStart(item)}>
                  <VStack gap={3}>
                    <VStack gap={1}>
                      <Text type="supporting">{item.category}</Text>
                      <Heading level={2}>{item.title}</Heading>
                    </VStack>
                    <Text type="label" color="accent">
                      작성 시작
                    </Text>
                  </VStack>
                </ClickableCard>
              ))}
            </Grid>
          </VStack>
        </LayoutContent>
      }
    />
  );
}
