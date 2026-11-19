"""Synthetic legal-narrative sentences with hand-marked PII, in Korean and in
parallel English. Every person, number and address is invented.

Each case is (id, text, [(group, exact substring), ...]). A substring must
occur exactly once in its text.
"""

KO = [
    (1, "채권자 김민수(주민등록번호 850312-1456789)는 2026. 3. 2. 채무자 박지훈에게 금 5,000,000원을 대여하였습니다.",
     [("NAME", "김민수"), ("NATIONAL_ID", "850312-1456789"), ("NAME", "박지훈")]),
    (2, "채무자의 주소는 서울특별시 강남구 테헤란로 152, 3층이며 연락처는 010-2345-6789입니다.",
     [("ADDRESS", "서울특별시 강남구 테헤란로 152, 3층"), ("PHONE", "010-2345-6789")]),
    (3, "임대인 이서연은 임차인 최동현에게 보증금 반환을 거부하고 있습니다.",
     [("NAME", "이서연"), ("NAME", "최동현")]),
    (4, "보증금은 국민은행 계좌 123456-04-789012(예금주 정하은)로 송금해 주시기 바랍니다.",
     [("ACCOUNT", "123456-04-789012"), ("NAME", "정하은")]),
    (5, "피고소인 강태윤은 2026. 5. 11. 피해자 윤소희의 휴대전화 010-9876-5432로 협박 문자를 보냈습니다.",
     [("NAME", "강태윤"), ("NAME", "윤소희"), ("PHONE", "010-9876-5432")]),
    (6, "주식회사 가나푸드(사업자등록번호 214-86-12345, 대표이사 김가나)는 물품을 공급하였습니다.",
     [("COMPANY", "주식회사 가나푸드"), ("BUSINESS_ID", "214-86-12345"), ("NAME", "김가나")]),
    (7, "근로자 한지민(생년월일 1994. 7. 21.)은 2025. 1. 2.부터 주식회사 한빛마트에서 근무하였습니다.",
     [("NAME", "한지민"), ("BIRTH_DATE", "1994. 7. 21."), ("COMPANY", "주식회사 한빛마트")]),
    (8, "채무자 오승우의 주민등록번호는 790815-1234567이고 주소는 부산광역시 해운대구 센텀중앙로 55입니다.",
     [("NAME", "오승우"), ("NATIONAL_ID", "790815-1234567"), ("ADDRESS", "부산광역시 해운대구 센텀중앙로 55")]),
    (9, "이메일 minsu.kim@example.com 또는 전화 02-555-0123으로 회신해 주십시오.",
     [("EMAIL", "minsu.kim@example.com"), ("PHONE", "02-555-0123")]),
    (10, "수신인: 경기도 성남시 분당구 판교역로 235, 에이치스퀘어 엔동 7층 장현우 귀하",
     [("ADDRESS", "경기도 성남시 분당구 판교역로 235, 에이치스퀘어 엔동 7층"), ("NAME", "장현우")]),
    (11, "고소인은 서지안이며, 피고소인 임채원과는 2024년경 직장 동료로 알게 되었습니다.",
     [("NAME", "서지안"), ("NAME", "임채원")]),
    (12, "매도인 배준호(법인등록번호 110111-1234567인 주식회사 대성산업의 대표이사)는 주식 1,000주를 양도합니다.",
     [("NAME", "배준호"), ("BUSINESS_ID", "110111-1234567"), ("COMPANY", "주식회사 대성산업")]),
    (13, "임차인 신유진은 대구광역시 수성구 달구벌대로 2450, 102동 1503호를 임차하여 거주하고 있습니다.",
     [("NAME", "신유진"), ("ADDRESS", "대구광역시 수성구 달구벌대로 2450, 102동 1503호")]),
    (14, "가해 차량(12가 3456) 운전자 문성민은 신호를 위반하여 피해자 차량을 충격하였습니다.",
     [("OTHER_ID", "12가 3456"), ("NAME", "문성민")]),
    (15, "채권자는 채무자 명의 신한은행 110-234-567890 계좌에 대한 압류를 신청합니다.",
     [("ACCOUNT", "110-234-567890")]),
    (16, "위임인 노은채(연락처 010-3333-4444)는 수임인 류재석에게 부동산 매매계약 체결 권한을 위임합니다.",
     [("NAME", "노은채"), ("PHONE", "010-3333-4444"), ("NAME", "류재석")]),
    (17, "피해자 황보라는 2026. 2. 14. 인스타그램 계정 @bora_hwang 에 게시된 글로 명예가 훼손되었습니다.",
     [("NAME", "황보라"), ("USERNAME", "@bora_hwang")]),
    (18, "양육비는 매월 말일 채권자 권나영 명의 우리은행 1002-345-678901 계좌로 지급한다.",
     [("NAME", "권나영"), ("ACCOUNT", "1002-345-678901")]),
    (19, "채 무 자  주식회사 한빛마트 (대표이사 박한빛)  서울특별시 강남구 테헤란로 2",
     [("COMPANY", "주식회사 한빛마트"), ("NAME", "박한빛"), ("ADDRESS", "서울특별시 강남구 테헤란로 2")]),
    (20, "홍길동(650505-1987654)과 성춘향(700707-2345678)은 2010. 5. 5. 혼인신고를 마친 법률상 부부입니다.",
     [("NAME", "홍길동"), ("NATIONAL_ID", "650505-1987654"), ("NAME", "성춘향"), ("NATIONAL_ID", "700707-2345678")]),
    (21, "퇴직한 근로자 안소윤에게 퇴직금 12,400,000원이 지급되지 않았으며, 사업주는 제주특별자치도 제주시 노형동 925에서 식당을 운영합니다.",
     [("NAME", "안소윤"), ("ADDRESS", "제주특별자치도 제주시 노형동 925")]),
    (22, "담당 변호사 구본혁(등록번호 제12345호)에게 사건을 위임하였습니다.",
     [("NAME", "구본혁"), ("OTHER_ID", "제12345호")]),
    (23, "채무자가 운영하는 식당은 인천광역시 연수구 송도과학로 32에 있고 사업자등록번호는 131-05-67890입니다.",
     [("ADDRESS", "인천광역시 연수구 송도과학로 32"), ("BUSINESS_ID", "131-05-67890")]),
    (24, "여권번호 M12345678인 외국인 근로자 응우옌 반 안은 2025. 3. 1. 입사하였습니다.",
     [("OTHER_ID", "M12345678"), ("NAME", "응우옌 반 안")]),
    (25, "피신청인 표지호의 운전면허번호는 11-12-345678-90입니다.",
     [("NAME", "표지호"), ("OTHER_ID", "11-12-345678-90")]),
    (26, "신청인의 딸 차은서(만 7세)는 현재 서울 마포구 소재 초등학교에 재학 중입니다.",
     [("NAME", "차은서")]),
    (27, "송달장소: 광주광역시 서구 상무중앙로 110, 5층 (우편번호 61945)",
     [("ADDRESS", "광주광역시 서구 상무중앙로 110, 5층"), ("ADDRESS", "61945")]),
    (28, "원고 모현수와 피고 탁경민 사이의 2025. 11. 3.자 금전소비대차계약에 따라 피고는 원금 3천만 원을 변제할 의무가 있습니다.",
     [("NAME", "모현수"), ("NAME", "탁경민")]),
    (29, "카카오톡 아이디 jiho_p92 를 사용하는 성명불상자가 피해자에게 300만 원을 편취하였습니다.",
     [("USERNAME", "jiho_p92")]),
    (30, "제 연락처는 010-5555-0101, 주소는 대전광역시 유성구 대학로 99이고, 상대방 육지원의 연락처는 모릅니다.",
     [("PHONE", "010-5555-0101"), ("ADDRESS", "대전광역시 유성구 대학로 99"), ("NAME", "육지원")]),
]

EN = [
    (1, "Creditor John Miller (Social Security number 512-45-6789) lent 5,000 dollars to debtor David Clark on March 2, 2026.",
     [("NAME", "John Miller"), ("NATIONAL_ID", "512-45-6789"), ("NAME", "David Clark")]),
    (2, "The debtor's address is 152 Madison Avenue, Floor 3, New York, NY 10016 and the phone number is (212) 555-0147.",
     [("ADDRESS", "152 Madison Avenue, Floor 3, New York, NY 10016"), ("PHONE", "(212) 555-0147")]),
    (3, "Landlord Sarah Johnson refuses to return the deposit to tenant Michael Brown.",
     [("NAME", "Sarah Johnson"), ("NAME", "Michael Brown")]),
    (4, "Please wire the deposit to Chase account 000123456789 (account holder Emily Davis).",
     [("ACCOUNT", "000123456789"), ("NAME", "Emily Davis")]),
    (5, "The accused, Kevin Turner, sent threatening texts to the victim Laura Hill's mobile phone 415-555-0198 on May 11, 2026.",
     [("NAME", "Kevin Turner"), ("NAME", "Laura Hill"), ("PHONE", "415-555-0198")]),
    (6, "Gana Foods Inc. (Employer Identification Number 12-3456789, CEO Grace Kim) supplied the goods.",
     [("COMPANY", "Gana Foods Inc."), ("BUSINESS_ID", "12-3456789"), ("NAME", "Grace Kim")]),
    (7, "Employee Hannah Lee (date of birth July 21, 1994) has worked at Hanbit Mart Inc. since January 2, 2025.",
     [("NAME", "Hannah Lee"), ("BIRTH_DATE", "July 21, 1994"), ("COMPANY", "Hanbit Mart Inc.")]),
    (8, "Debtor Oscar Reed's Social Security number is 078-05-1120 and his address is 55 Harbor Road, Boston, MA 02110.",
     [("NAME", "Oscar Reed"), ("NATIONAL_ID", "078-05-1120"), ("ADDRESS", "55 Harbor Road, Boston, MA 02110")]),
    (9, "Please reply by email at john.miller@example.com or by phone at 617-555-0123.",
     [("EMAIL", "john.miller@example.com"), ("PHONE", "617-555-0123")]),
    (10, "To: Mr. Henry Collins, 235 Pine Street, Suite 700, San Francisco, CA 94104",
     [("NAME", "Henry Collins"), ("ADDRESS", "235 Pine Street, Suite 700, San Francisco, CA 94104")]),
    (11, "The complainant is Julia Scott, who met the accused, Rachel Adams, as a coworker around 2024.",
     [("NAME", "Julia Scott"), ("NAME", "Rachel Adams")]),
    (12, "Seller Brian Cooper (CEO of Daesung Industries Inc., corporate registration number 5501234) transfers 1,000 shares.",
     [("NAME", "Brian Cooper"), ("COMPANY", "Daesung Industries Inc."), ("BUSINESS_ID", "5501234")]),
    (13, "Tenant Olivia Ward rents and lives at 2450 Elm Street, Apt 1503, Chicago, IL 60601.",
     [("NAME", "Olivia Ward"), ("ADDRESS", "2450 Elm Street, Apt 1503, Chicago, IL 60601")]),
    (14, "Daniel Foster, the driver of the at-fault vehicle (license plate 7ABC123), ran a red light and struck the victim's car.",
     [("NAME", "Daniel Foster"), ("OTHER_ID", "7ABC123")]),
    (15, "The creditor requests seizure of the debtor's Bank of America account 004412345678.",
     [("ACCOUNT", "004412345678")]),
    (16, "Principal Nora Bennett (phone 303-555-0144) authorizes agent Ryan Jacobs to conclude the real estate sale contract.",
     [("NAME", "Nora Bennett"), ("PHONE", "303-555-0144"), ("NAME", "Ryan Jacobs")]),
    (17, "Victim Bella Hunt was defamed by a post published on February 14, 2026 on the Instagram account @bella_hunt .",
     [("NAME", "Bella Hunt"), ("USERNAME", "@bella_hunt")]),
    (18, "Child support shall be paid at the end of each month to Wells Fargo account 3345678901 in the name of creditor Nancy Price.",
     [("ACCOUNT", "3345678901"), ("NAME", "Nancy Price")]),
    (19, "Debtor  Hanbit Mart Inc. (CEO Paul Harris)  2 Madison Avenue, New York, NY 10010",
     [("COMPANY", "Hanbit Mart Inc."), ("NAME", "Paul Harris"), ("ADDRESS", "2 Madison Avenue, New York, NY 10010")]),
    (20, "James Wilson (SSN 219-09-9999) and Mary Walker (SSN 457-55-5462) are a married couple who registered their marriage on May 5, 2010.",
     [("NAME", "James Wilson"), ("NATIONAL_ID", "219-09-9999"), ("NAME", "Mary Walker"), ("NATIONAL_ID", "457-55-5462")]),
    (21, "Severance pay of 12,400 dollars was not paid to former employee Amy Stone, and the employer runs a restaurant at 925 Ocean Drive, Miami, FL 33139.",
     [("NAME", "Amy Stone"), ("ADDRESS", "925 Ocean Drive, Miami, FL 33139")]),
    (22, "The case was entrusted to attorney Gordon Blake (bar number 123456).",
     [("NAME", "Gordon Blake"), ("OTHER_ID", "123456")]),
    (23, "The restaurant run by the debtor is located at 32 Science Park Road, Austin, TX 78701 and its Employer Identification Number is 74-1234567.",
     [("ADDRESS", "32 Science Park Road, Austin, TX 78701"), ("BUSINESS_ID", "74-1234567")]),
    (24, "Foreign worker Nguyen Van An, passport number 512345678, joined the company on March 1, 2025.",
     [("NAME", "Nguyen Van An"), ("OTHER_ID", "512345678")]),
    (25, "Respondent Peter Quinn's driver's license number is D1234567.",
     [("NAME", "Peter Quinn"), ("OTHER_ID", "D1234567")]),
    (26, "The applicant's daughter Chloe Evans (age 7) currently attends an elementary school in Brooklyn.",
     [("NAME", "Chloe Evans")]),
    (27, "Service address: 110 Central Avenue, Floor 5, Seattle, WA 98101",
     [("ADDRESS", "110 Central Avenue, Floor 5, Seattle, WA"), ("ADDRESS", "98101")]),
    (28, "Under the loan agreement dated November 3, 2025 between plaintiff Henry Morris and defendant Thomas Kent, the defendant must repay the principal of 30,000 dollars.",
     [("NAME", "Henry Morris"), ("NAME", "Thomas Kent")]),
    (29, "An unidentified person using the Telegram ID jake_p92 defrauded the victim of 3,000 dollars.",
     [("USERNAME", "jake_p92")]),
    (30, "My phone number is 206-555-0101, my address is 99 University Way, Seattle, WA 98105, and I do not know the contact details of the other party, Zoe Fisher.",
     [("PHONE", "206-555-0101"), ("ADDRESS", "99 University Way, Seattle, WA 98105"), ("NAME", "Zoe Fisher")]),
]


def records():
    """One dict per sentence, with each gold span located by character offset."""
    out = []
    for lang, cases in (("ko", KO), ("en", EN)):
        for number, text, spans in cases:
            located = []
            for group, value in spans:
                assert text.count(value) == 1, (lang, number, value, text.count(value))
                start = text.index(value)
                located.append({"group": group, "text": value, "start": start, "end": start + len(value)})
            out.append({"id": f"{lang}-{number:02d}", "lang": lang, "text": text, "gold": located})
    return out


if __name__ == "__main__":
    from collections import Counter
    rows = records()
    for lang in ("ko", "en"):
        counts = Counter(span["group"] for row in rows if row["lang"] == lang for span in row["gold"])
        print(lang, sum(1 for row in rows if row["lang"] == lang), "sentences,", sum(counts.values()), "spans", dict(sorted(counts.items())))
