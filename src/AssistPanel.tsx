// Fills the form from pasted text. The core masks the text, the person
// approves exactly what leaves, and each answer the core reads comes back as
// a candidate beside its field. This panel shows and asks; it reads nothing.

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { List, ListItem } from "@astryxdesign/core/List";
import { Spinner } from "@astryxdesign/core/Spinner";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useEffect, useState } from "react";
import type { Filling } from "./App";
import type { AssistError } from "./bindings/AssistError";
import type { AssistStatus } from "./bindings/AssistStatus";
import type { Candidate } from "./bindings/Candidate";
import type { MaskPreview } from "./bindings/MaskPreview";
import type { Rejection } from "./bindings/Rejection";
import type { SentBody } from "./bindings/SentBody";
import type { TurnFailure } from "./bindings/TurnFailure";
import * as ipc from "./ipc";

export type Readable = Extract<Candidate, { status: "readable" }>;
type Rejected = Extract<Candidate, { status: "rejected" }>;

type Phase =
  | { kind: "pasting" }
  | { kind: "previewing"; preview: MaskPreview; words: string[] }
  /** A new preview with changed words is on its way; the shown one can no longer be approved. */
  | { kind: "remasking"; preview: MaskPreview; words: string[] }
  | { kind: "running"; preview: MaskPreview; words: string[] }
  | { kind: "done"; turn: string; offered: number; rejected: Rejected[]; sent: SentBody[] | null }
  | { kind: "failed"; message: string };

const ASSIST_ERRORS: Record<AssistError["type"], string> = {
  unknown_document: "이 문서에는 도우미를 쓸 수 없습니다.",
  not_approved: "보내려던 글이 마지막으로 미리 본 글과 달라서 보내지 않았습니다. 다시 미리 보고 승인하세요.",
  word_too_short: "한 글자는 가릴 수 없습니다. 그 글자가 든 다른 말까지 가려지기 때문입니다. 이름 전체처럼 두 글자 이상을 적으세요.",
};

function messageOf(error: unknown): string {
  const known = ipc.asAssistError(error);
  return known ? ASSIST_ERRORS[known.type] : String(error);
}

const REJECTIONS: Record<Rejection, string> = {
  field_not_offered: "지금 양식이 묻지 않는 칸이라 쓰지 않았습니다.",
  not_a_choice: "선택지에 없는 값이라 쓰지 않았습니다.",
  quote_not_in_text: "보낸 글에 없는 부분을 가리켜서 쓰지 않았습니다.",
  quote_ambiguous: "가리킨 부분이 글에 여러 번 나와서 쓰지 않았습니다.",
  not_whole_value: "가리킨 부분이 더 긴 숫자의 일부이거나, 음수나 단가이거나, 원 단위 금액이 아니라서 쓰지 않았습니다.",
  value_unreadable: "가리킨 부분을 값으로 읽지 못해서 쓰지 않았습니다.",
};

const FAILURES: Record<TurnFailure["why"], string> = {
  no_recording:
    "이 글에 대한 녹화된 응답이 없습니다. 이 빌드는 녹화해 둔 예시 글(계약서, 거래명세서, 문자 대화)에만 응답합니다.",
};

/** Who a recorded request was addressed to, in words. */
const RECIPIENTS: Record<string, string> = { openai: "OpenAI" };

/** A placeholder the core put in the masked text: `⟦전화번호1⟧` or `{{ creditor_name }}`. */
const PLACEHOLDER = /(⟦[^⟧]+⟧|\{\{ [^}]+ \}\})/;

export function AssistPanel({
  filling,
  onCandidates,
}: {
  filling: Filling;
  onCandidates: (candidates: Readable[]) => void;
}) {
  const [status, setStatus] = useState<AssistStatus | null>(null);
  const [pasted, setPasted] = useState("");
  const [word, setWord] = useState("");
  const [wordProblem, setWordProblem] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "pasting" });

  useEffect(() => {
    ipc.assistStatus().then(setStatus, (error) => setPhase({ kind: "failed", message: String(error) }));
  }, []);

  const labelOf = (id: string) =>
    filling.form.steps.flatMap((step) => step.fields).find((field) => field.id === id)?.label ?? id;

  /** Shows the text masked with these words. Resolves whether the new preview is now shown. */
  async function preview(words: string[]): Promise<boolean> {
    const shown = phase.kind === "previewing" ? phase : null;
    if (shown) setPhase({ ...shown, kind: "remasking" });
    try {
      const next = await ipc.assistPreview(pasted, filling.doc.id, filling.answers, words);
      setPhase({ kind: "previewing", preview: next, words });
      return true;
    } catch (error) {
      if (shown && ipc.asAssistError(error)?.type === "word_too_short") {
        setPhase(shown);
        setWordProblem(messageOf(error));
      } else {
        setPhase({ kind: "failed", message: messageOf(error) });
      }
      return false;
    }
  }

  async function approve(preview: MaskPreview, words: string[]) {
    setPhase({ kind: "running", preview, words });
    try {
      const run = await ipc.assistRun({ kind: "fill", doc: filling.doc.id }, preview.text_id);
      if (run.outcome.kind === "failed") {
        setPhase({ kind: "failed", message: FAILURES[run.outcome.failure.why] });
        return;
      }
      const candidates = run.outcome.candidates;
      const readable = candidates.filter((candidate): candidate is Readable => candidate.status === "readable");
      onCandidates(readable);
      setPhase({
        kind: "done",
        turn: run.turn,
        offered: readable.length,
        rejected: candidates.filter((candidate): candidate is Rejected => candidate.status === "rejected"),
        sent: null,
      });
    } catch (error) {
      setPhase({ kind: "failed", message: messageOf(error) });
    }
  }

  return (
    <VStack gap={5}>
      <VStack gap={1}>
        <Heading level={5} accessibilityLevel={2}>
          붙여 넣은 글로 채우기
        </Heading>
        <Text type="supporting" color="secondary">
          자료에서 찾은 값을 칸 옆에 후보로 보여 줍니다. 받아들인 후보만 답이 됩니다.
        </Text>
      </VStack>

      {status?.mode === "replay" && (
        <Banner
          status="info"
          title="녹화된 응답을 재생하는 빌드입니다"
          description="AI 서비스를 부르지 않습니다. 미리 녹화한 응답을 돌려주고, 글은 이 기기 밖으로 나가지 않습니다."
          data-assist="replay"
        />
      )}

      {phase.kind === "pasting" && (
        <VStack gap={3} data-assist="paste">
          <TextArea
            label="붙여 넣을 글"
            description="계약서, 거래명세서, 문자 대화를 붙여 넣으세요. 승인하기 전에는 아무것도 보내지 않습니다."
            rows={8}
            value={pasted}
            onChange={setPasted}
          />
          <HStack>
            <Button
              label="가린 글 미리 보기"
              data-action="preview"
              isDisabled={pasted.trim() === ""}
              clickAction={() => preview([]).then(() => {})}
            />
          </HStack>
        </VStack>
      )}

      {(phase.kind === "previewing" || phase.kind === "remasking" || phase.kind === "running") && (
        <VStack gap={4} data-assist="preview">
          <VStack gap={2}>
            <Text type="label">보낼 글</Text>
            <Text type="supporting" color="secondary">
              {summary(phase.preview)} 이름, 상호, 주소처럼 아직 보이는 개인정보는 아래에서 더 가리세요.
            </Text>
            <Card variant="muted" padding={3}>
              <MaskedText text={phase.preview.masked} />
            </Card>
          </VStack>

          <VStack gap={2} data-assist="word">
            <TextInput
              label="더 가릴 말"
              placeholder="예: 김가나"
              value={word}
              onChange={(next) => {
                setWord(next);
                setWordProblem(null);
              }}
              isDisabled={phase.kind === "running"}
              status={wordProblem === null ? undefined : { type: "error", message: wordProblem }}
              onEnter={() => addWord(phase.words)}
            />
            <HStack gap={2}>
              <Button
                label="가리기"
                size="sm"
                data-action="mask-word"
                isDisabled={word.trim() === "" || phase.kind === "running"}
                isLoading={phase.kind === "remasking"}
                onClick={() => addWord(phase.words)}
              />
            </HStack>
            {phase.words.length > 0 && (
              <List density="compact" hasDividers>
                {phase.words.map((masked) => (
                  <ListItem
                    key={masked}
                    label={masked}
                    data-masked-word={masked}
                    endContent={
                      <Button
                        label="가리지 않기"
                        size="sm"
                        variant="ghost"
                        isDisabled={phase.kind !== "previewing"}
                        onClick={() => preview(phase.words.filter((candidate) => candidate !== masked))}
                      />
                    }
                  />
                ))}
              </List>
            )}
          </VStack>

          {phase.kind === "running" ? (
            <Spinner label="응답을 기다리는 중" />
          ) : (
            <VStack gap={2}>
              <Text type="supporting" color="secondary">
                {phase.kind === "remasking"
                  ? "가린 글을 다시 만드는 중입니다. 새 글이 보이면 승인할 수 있습니다."
                  : "승인하면 위의 가린 글과 빈 칸의 이름만 보냅니다."}
              </Text>
              <HStack gap={2}>
                <Button
                  label="승인하고 보내기"
                  data-action="approve"
                  isDisabled={phase.kind !== "previewing"}
                  onClick={() => approve(phase.preview, phase.words)}
                />
                <Button
                  label="취소"
                  variant="ghost"
                  isDisabled={phase.kind !== "previewing"}
                  onClick={() => setPhase({ kind: "pasting" })}
                />
              </HStack>
            </VStack>
          )}
        </VStack>
      )}

      {phase.kind === "done" && (
        <VStack gap={4} data-assist="done">
          <Banner
            status="success"
            title={`후보 ${phase.offered}개를 찾았습니다`}
            description="후보가 있는 단계는 왼쪽 단계 목록에 개수로 표시했습니다. 선택에 따라 나타나는 칸의 후보는 그 칸이 보일 때 나옵니다. 받아들여야 답이 됩니다."
          />
          {phase.rejected.length > 0 && (
            <VStack gap={2}>
              <Text type="label">쓰지 않은 제안 {phase.rejected.length}개</Text>
              <List density="compact" hasDividers>
                {phase.rejected.map((rejected) => (
                  <ListItem
                    key={rejected.field}
                    label={labelOf(rejected.field)}
                    description={
                      <Text type="supporting" color="secondary">
                        {REJECTIONS[rejected.reason]}
                      </Text>
                    }
                  />
                ))}
              </List>
            </VStack>
          )}
          {phase.sent === null ? (
            <HStack gap={2}>
              <Button
                label="보낸 내용 보기"
                size="sm"
                data-action="show-sent"
                onClick={() =>
                  ipc.assistSent(phase.turn).then(
                    (sent) => setPhase({ ...phase, sent }),
                    (error) => setPhase({ kind: "failed", message: String(error) }),
                  )
                }
              />
              <Button label="새 글 붙여 넣기" size="sm" variant="ghost" onClick={() => setPhase({ kind: "pasting" })} />
            </HStack>
          ) : (
            <VStack gap={4} data-assist="sent">
              {phase.sent.map((sent, index) => (
                <VStack key={index} gap={4}>
                  <VStack gap={1}>
                    <Text type="label">보낸 내용</Text>
                    <Text type="supporting" color="secondary">
                      받는 곳: {RECIPIENTS[sent.to] ?? sent.to}. 담긴 것은 아래 두 가지뿐입니다.
                      {status?.mode === "replay" && " 이 빌드는 녹화된 응답을 재생하므로 실제로는 보내지 않았습니다."}
                    </Text>
                  </VStack>
                  <VStack gap={2}>
                    <Text type="label">가린 글</Text>
                    <Card variant="muted" padding={3}>
                      <MaskedText text={sent.request.text} />
                    </Card>
                  </VStack>
                  <VStack gap={1}>
                    <Text type="label">물어본 칸 {sent.request.fields.length}개</Text>
                    <Text type="supporting" color="secondary">
                      칸의 이름과 설명입니다. 이미 적은 답은 보내지 않았고, 개인정보 칸은 이름만 보냈습니다.
                    </Text>
                    <Text type="body">{sent.request.fields.map((field) => field.label).join(", ")}</Text>
                  </VStack>
                  <Collapsible
                    defaultIsOpen={false}
                    trigger={<Text type="label" data-action="show-raw">보낸 그대로 보기 (개발자용 JSON)</Text>}
                  >
                    <Card variant="muted" padding={3}>
                      <Text type="code" display="block" wordBreak="break-all" data-sent>
                        {sent.body}
                      </Text>
                    </Card>
                  </Collapsible>
                </VStack>
              ))}
              <HStack gap={2}>
                <Button label="보낸 내용 접기" size="sm" data-action="hide-sent" onClick={() => setPhase({ ...phase, sent: null })} />
                <Button label="새 글 붙여 넣기" size="sm" variant="ghost" onClick={() => setPhase({ kind: "pasting" })} />
              </HStack>
            </VStack>
          )}
        </VStack>
      )}

      {phase.kind === "failed" && (
        <VStack gap={3} data-assist="failed">
          <Banner status="error" title="후보를 받지 못했습니다" description={phase.message} />
          <HStack>
            <Button label="다시 붙여 넣기" size="sm" onClick={() => setPhase({ kind: "pasting" })} />
          </HStack>
        </VStack>
      )}
    </VStack>
  );

  async function addWord(words: string[]) {
    const added = word.trim();
    if (phase.kind !== "previewing" || added === "" || words.includes(added)) return;
    if (await preview([...words, added])) setWord("");
  }
}

function summary(preview: MaskPreview): string {
  const automatic = preview.found.filter((found) => found.by !== "user").length;
  const chosen = preview.found.length - automatic;
  return `자동으로 가린 것 ${automatic}개, 직접 가린 것 ${chosen}개.`;
}

/** The masked text line by line, as the preview showed it. */
function MaskedText({ text }: { text: string }) {
  return (
    <VStack gap={0} data-masked>
      {text.split("\n").map((line, index) => (
        <Text key={index} type="body" display="block" wordBreak="break-word">
          {line === "" ? " " : <MaskedLine line={line} />}
        </Text>
      ))}
    </VStack>
  );
}

/** Shows the placeholders in the masked line apart from the person's own words. */
function MaskedLine({ line }: { line: string }) {
  return (
    <>
      {line.split(PLACEHOLDER).map((part, index) =>
        index % 2 === 1 ? (
          <Text key={index} type="inherit" weight="semibold" color="accent">
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </>
  );
}
