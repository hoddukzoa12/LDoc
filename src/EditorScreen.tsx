import { save } from "@tauri-apps/plugin-dialog";
import { UniverDocsCorePreset } from "@univerjs/preset-docs-core";
import docsCoreKoKR from "@univerjs/preset-docs-core/locales/ko-KR";
import "@univerjs/preset-docs-core/lib/index.css";
import { createUniver, type IDocumentData, LocaleType, mergeLocales } from "@univerjs/presets";
import { useEffect, useRef, useState } from "react";
import type { Draft } from "./bindings/Draft";
import { exportDocx } from "./ipc";
import { fromUniver, toUniver } from "./univer-document";

type Exported = { kind: "none" } | { kind: "saved"; path: string } | { kind: "failed"; message: string };

const won = new Intl.NumberFormat("ko-KR");

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
    <div className="editing">
      <div className="editor-bar">
        <button type="button" className="secondary" onClick={onBack}>
          ← 답변 수정
        </button>
        <p className="editor-hint">초안을 직접 고칠 수 있습니다. 고친 그대로 Word 파일에 담깁니다.</p>
        {exported.kind === "saved" && (
          <p className="export-status saved" role="status">
            저장했습니다 · {exported.path}
          </p>
        )}
        {exported.kind === "failed" && (
          <p className="export-status failed" role="alert">
            저장하지 못했습니다 · {exported.message}
          </p>
        )}
        <button type="button" className="primary" onClick={exportEdited}>
          Word 파일로 내보내기
        </button>
      </div>

      <div className="editor-body">
        <div className="editor-host" ref={host} />
        <aside className="draft-side">
          <section>
            <h2>납부할 비용</h2>
            <ul className="costs">
              {draft.costs.map((cost) => (
                <li key={cost.label}>
                  <div className="cost-line">
                    <span>{cost.label}</span>
                    <strong>{won.format(cost.amount)}원</strong>
                  </div>
                  <p className="cost-basis">{cost.basis}</p>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2>확인할 사항</h2>
            <ul className="notices">
              {draft.notices.map((notice) => (
                <li key={notice}>{notice}</li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
