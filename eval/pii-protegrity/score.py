"""Scores predictions.jsonl from the Kaggle run against the gold spans.

    python3 score.py predictions.jsonl [--threshold 0.5] [--details]

A gold span is
  full     when every non-space character of it lies inside predicted spans
  partial  when some but not all of it does
  missed   when none of it does
Full coverage is what masking needs: a half-covered number still leaks.
The label a prediction carries is ignored for these three. "typed" counts
full spans whose covering label belongs to the gold span's group.
"""
import argparse
import json
import re
from collections import Counter, defaultdict

from cases import records

GROUP_LABELS = {
    "NAME": {"NAME", "ACCOUNTNAME"},
    "NATIONAL_ID": {"SSN", "IDCARD"},
    "PHONE": {"PHONE", "FAX_NUMBER"},
    "ADDRESS": {"STREET", "CITY", "STATE", "COUNTY", "COUNTRY", "BUILDING", "SECADDRESS", "ZIPCODE"},
    "ACCOUNT": {"ACCOUNTNUMBER", "IBAN"},
    "BUSINESS_ID": {"IDCARD", "SSN", "PROFESSIONAL_LICENSE_NUMBER"},
    "EMAIL": {"EMAIL"},
    "COMPANY": {"COMPANYNAME"},
    "OTHER_ID": {"PASSPORT", "DRIVERLICENSE", "VEHICLE_REGISTRATION", "PROFESSIONAL_LICENSE_NUMBER", "IDCARD"},
    "BIRTH_DATE": {"DATE"},
    "USERNAME": {"USERNAME"},
}

# The Korean identifiers that have a fixed written shape.
REGEX = {
    "NATIONAL_ID": r"\d{6}-[1-8]\d{6}",
    "PHONE": r"0\d{1,2}-\d{3,4}-\d{4}",
    "BUSINESS_ID": r"\d{3}-\d{2}-\d{5}|\d{6}-\d{7}",
    "ACCOUNT": r"\d{3,6}-\d{2,6}-\d{5,8}",
    "EMAIL": r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+",
}


def judge(text, gold, spans):
    wanted = {i for i in range(gold["start"], gold["end"]) if not text[i].isspace()}
    covering = [span for span in spans if span["start"] < gold["end"] and span["end"] > gold["start"]]
    covered = {i for span in covering for i in range(span["start"], span["end"])} & wanted
    if not covered:
        return "missed", covering
    return ("full" if covered == wanted else "partial"), covering


def is_hangul(char):
    return "가" <= char <= "힣"


def score(rows, gold_rows, threshold):
    table = defaultdict(Counter)
    details, extras, swallowed = [], [], []
    for row in rows:
        gold_row = gold_rows[row["id"]]
        assert row["text"] == gold_row["text"], row["id"]
        text, lang = row["text"], row["lang"]
        spans = [span for span in row["spans"] if span["score"] >= threshold]
        for gold in gold_row["gold"]:
            verdict, covering = judge(text, gold, spans)
            labels = {span["label"] for span in covering}
            for key in ((lang, gold["group"]), (lang, "ALL")):
                table[key]["n"] += 1
                table[key][verdict] += 1
                if verdict == "full" and labels & GROUP_LABELS[gold["group"]]:
                    table[key]["typed"] += 1
            if verdict != "full":
                details.append((row["id"], gold["group"], gold["text"], verdict, [(s["label"], s["text"]) for s in covering]))
            for span in covering:
                tail = text[gold["end"]:span["end"]]
                if tail and is_hangul(tail[0]):
                    swallowed.append((row["id"], gold["text"], span["text"]))
        for span in spans:
            if not any(span["start"] < g["end"] and span["end"] > g["start"] for g in gold_row["gold"]):
                extras.append((row["id"], span["label"], span["text"], span["score"]))
    return table, details, extras, swallowed


def regex_baseline(gold_rows):
    table = defaultdict(Counter)
    for row in gold_rows.values():
        if row["lang"] != "ko":
            continue
        spans = [{"start": m.start(), "end": m.end(), "label": group, "score": 1.0, "text": m.group()}
                 for group, pattern in REGEX.items() for m in re.finditer(pattern, row["text"])]
        for gold in row["gold"]:
            verdict, _ = judge(row["text"], gold, spans)
            table[gold["group"]]["n"] += 1
            table[gold["group"]][verdict] += 1
    return table


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("predictions")
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--details", action="store_true")
    args = parser.parse_args()

    rows = [json.loads(line) for line in open(args.predictions, encoding="utf-8") if line.strip()]
    gold_rows = {row["id"]: row for row in records()}
    assert {row["id"] for row in rows} == set(gold_rows), "the run did not cover every sentence"

    table, details, extras, swallowed = score(rows, gold_rows, args.threshold)
    groups = ["ALL"] + sorted(GROUP_LABELS)
    print(f"model, threshold {args.threshold}: full / partial / missed of n  (typed)")
    print(f"{'group':<12} {'Korean':<26} {'English':<26}")
    for group in groups:
        cells = []
        for lang in ("ko", "en"):
            c = table[(lang, group)]
            cells.append(f"{c['full']:>2} / {c['partial']:>2} / {c['missed']:>2} of {c['n']:>2} ({c['typed']:>2})")
        print(f"{group:<12} {cells[0]:<26} {cells[1]:<26}")

    print("\nfull coverage of all spans by threshold")
    for threshold in (0.9, 0.5, 0.3, 0.1, 0.0):
        t, _, e, _ = score(rows, gold_rows, threshold)
        outside = Counter(row_id[:2] for row_id, *_ in e)
        print(f"  {threshold:<4} ko {t[('ko', 'ALL')]['full']:>2}/{t[('ko', 'ALL')]['n']}  en {t[('en', 'ALL')]['full']:>2}/{t[('en', 'ALL')]['n']}"
              f"   spans outside gold: ko {outside['ko']}, en {outside['en']}")

    print("\nregex only, Korean: full / partial / missed of n")
    baseline = regex_baseline(gold_rows)
    for group in sorted(baseline):
        c = baseline[group]
        print(f"  {group:<12} {c['full']:>2} / {c['partial']:>2} / {c['missed']:>2} of {c['n']:>2}")

    print(f"\nKorean predictions that ran on into the following particle: {len([s for s in swallowed if s[0].startswith('ko')])}")
    if args.details:
        print("\nnot fully covered:")
        for item in details:
            print("  ", *item)
        print("\npredicted outside every gold span:")
        for item in extras:
            print("  ", *item)
        print("\nran on into Hangul after the gold span:")
        for item in swallowed:
            print("  ", *item)


if __name__ == "__main__":
    main()
