import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent, LayoutHeader, LayoutPanel } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { save } from "@tauri-apps/plugin-dialog";
import { UniverDocsCorePreset } from "@univerjs/preset-docs-core";
import docsCoreKoKR from "@univerjs/preset-docs-core/locales/ko-KR";
import "@univerjs/preset-docs-core/lib/index.css";
import { createUniver, type IDocumentData, LocaleType, mergeLocales } from "@univerjs/presets";
import { useEffect, useRef, useState } from "react";
import type { Draft } from "./bindings/Draft";
import { Disclaimer } from "./Disclaimer";
import { exportDocx } from "./ipc";
import { fromUniver, toUniver } from "./univer-document";

type Exported = { kind: "none" } | { kind: "saved"; path: string } | { kind: "failed"; message: string };

const won = new Intl.NumberFormat("ko-KR");

/** The costs and notices beside the page, as wide as the editor template's inspector. */
const PANEL_WIDTH = 340;

export function EditorScreen({ title, draft, onBack }: { title: string; draft: Draft; onBack: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const snapshot = useRef<(() => IDocumentData) | null>(null);
  const [exported, setExported] = useState<Exported>({ kind: "none" });

  useEffect(() => {
    const { univer, univerAPI } = createUniver({
      locale: LocaleType.KO_KR,
      locales: { [LocaleType.KO_KR]: mergeLocales(docsCoreKoKR) },
      presets: [UniverDocsCorePreset({ container: host.current!, footer: false })],
    });
    const document = univerAPI.createDocument(toUniver(draft.document));
    snapshot.current = () => document.save();
    return () => {
      snapshot.current = null;
      univer.dispose();
    };
  }, [draft]);

  async function exportEdited() {
    const read = snapshot.current;
    if (!read) return;
    try {
      const document = fromUniver(read());
      const path = await save({
        title: "Word 파일로 저장",
        defaultPath: `${title}.docx`,
        filters: [{ name: "Word 문서", extensions: ["docx"] }],
      });
      if (path === null) return;
      await exportDocx(document, path);
      setExported({ kind: "saved", path });
    } catch (error) {
      setExported({ kind: "failed", message: String(error) });
    }
  }

  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider>
          <Toolbar
            label="초안 편집"
            startContent={
              <Button label="답변 수정" variant="ghost" icon={<Icon icon="chevronLeft" size="sm" />} onClick={onBack} />
            }
            centerContent={
              exported.kind === "saved" ? (
                <Text type="supporting" color="secondary" role="status" data-export="saved" maxLines={1}>
                  저장했습니다 · {exported.path}
                </Text>
              ) : exported.kind === "failed" ? (
                <Text type="supporting" color="secondary" role="alert" data-export="failed" maxLines={1}>
                  저장하지 못했습니다 · {exported.message}
                </Text>
              ) : (
                <Text type="supporting" color="secondary">
                  초안을 직접 고칠 수 있습니다. 고친 그대로 Word 파일에 담깁니다.
                </Text>
              )
            }
            endContent={
              <Button label="Word 파일로 내보내기" variant="primary" data-action="export" onClick={exportEdited} />
            }
          />
        </LayoutHeader>
      }
      content={
        <LayoutContent padding={0} isScrollable={false}>
          {/* Univer draws the page into this element and sizes itself to it. */}
          <div ref={host} data-editor-host style={{ height: "100%", position: "relative" }} />
        </LayoutContent>
      }
      end={
        <LayoutPanel width={PANEL_WIDTH} hasDivider role="complementary" label="비용과 확인할 사항">
          <VStack gap={6}>
            <Disclaimer />
            <VStack gap={2}>
              <Heading level={2}>납부할 비용</Heading>
              <List hasDividers edge="flush">
                {draft.costs.map((cost) => (
                  <ListItem
                    key={cost.label}
                    label={cost.label}
                    description={
                      <Text type="supporting" color="secondary">
                        {cost.basis}
                      </Text>
                    }
                    endContent={
                      <Text type="body" weight="semibold" hasTabularNumbers>
                        {won.format(cost.amount)}원
                      </Text>
                    }
                  />
                ))}
              </List>
            </VStack>
            <VStack gap={2}>
              <Heading level={2}>확인할 사항</Heading>
              <List listStyle="disc" density="compact">
                {draft.notices.map((notice) => (
                  <ListItem
                    key={notice}
                    label={
                      <Text type="body" color="secondary">
                        {notice}
                      </Text>
                    }
                  />
                ))}
              </List>
            </VStack>
          </VStack>
        </LayoutPanel>
      }
    />
  );
}
