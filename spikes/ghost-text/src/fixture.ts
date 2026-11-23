// FIXTURE, NOT LEGAL CONTENT. Canned suggestion text for the ghost-text spike,
// loosely shaped after the 단시간 근로계약서 template in the drafter guide
// (references/doc-141.md). Nobody reviewed it as a contract; do not reuse it.

/** Known document titles and the skeleton that follows each, one paragraph per line. */
export const SKELETONS: Record<string, string> = {
  근로계약서: [
    '____(이하 "갑"이라 한다)과 ____(이하 "을"이라 한다)은 다음과 같이 근로계약을 체결한다.',
    "제1조 (계약기간) 20__년 __월 __일부터 20__년 __월 __일까지로 한다.",
    "제2조 (근무장소) ____",
    "제3조 (업무내용) ____",
    "제4조 (근로시간) 시업 __:__, 종업 __:__, 휴게시간 __:__부터 __:__까지로 한다.",
    "제5조 (근무일과 휴일) 매주 __일 근무하며, 주휴일은 매주 __요일로 한다.",
    "제6조 (임금) 월 ____원을 매월 __일에 을 명의 계좌로 지급한다.",
    "제7조 (연차유급휴가) 근로기준법에서 정하는 바에 따라 부여한다.",
    "제8조 (사회보험) 국민연금, 건강보험, 고용보험, 산재보험에 가입한다.",
    "제9조 (계약서 교부) 갑은 계약 체결과 동시에 이 계약서 1부를 을에게 교부한다.",
    "제10조 (기타) 이 계약에 정하지 않은 사항은 근로기준법에 따른다.",
    "20__년 __월 __일",
    "갑 ____ (서명)        을 ____ (서명)",
  ].join("\n"),
};

/** Phrases that, typed at the end of a clause, offer a clause after a pause. */
export const TRIGGERS: { phrase: string; text: string }[] = [
  {
    phrase: "수습",
    text:
      "기간은 입사일부터 ____개월로 하고, 수습기간 중 임금은 월 ____원으로 한다. " +
      "수습기간이 끝나기 ____일 전까지 갑이 본채용 거절을 서면으로 알리지 않으면 을은 본채용된 것으로 본다.",
  },
];
