import { Banner } from "@astryxdesign/core/Banner";

/** The notice the screen fixes where a document is chosen and where it is exported. The model never writes it. */
export function Disclaimer() {
  return (
    <Banner
      status="warning"
      title="참고용이며 법률 자문이 아닙니다"
      description="LDoc의 초안은 법률 전문가가 검토하지 않았습니다. 제출하기 전에 법률 전문가의 검토를 받으세요."
      data-disclaimer
    />
  );
}
