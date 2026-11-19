"""Writes kernel/run.py (the Kaggle script, with the test sentences embedded)
and kernel/kernel-metadata.json.

    python3 build_kernel.py <kaggle-username>
"""
import json
import sys
from pathlib import Path

from cases import records

username = sys.argv[1]
texts = [{"id": row["id"], "lang": row["lang"], "text": row["text"]} for row in records()]

RUN = r'''
import json, sys, time, platform
from pathlib import Path

TEXTS = json.loads(r"""__TEXTS__""")

model_dir = next(path.parent for path in Path("/kaggle/input").rglob("inference.py"))
sys.path.insert(0, str(model_dir))

import torch, transformers
from transformers import AutoModelForTokenClassification
from inference import load, detect

print("python", platform.python_version(), "torch", torch.__version__, "transformers", transformers.__version__)
print("pinned by the model: torch==2.10.0 transformers==4.57.6")
print("model dir", model_dir, "cuda", torch.cuda.is_available())

# Every weight must come from the checkpoint. A missing key would mean a
# randomly initialised layer and meaningless predictions.
_, info = AutoModelForTokenClassification.from_pretrained(model_dir, output_loading_info=True)
print("missing keys", len(info["missing_keys"]), "unexpected keys", len(info["unexpected_keys"]),
      "mismatched", len(info["mismatched_keys"]))
assert not info["missing_keys"] and not info["mismatched_keys"], info

model, tokenizer = load(model_dir)
print("labels", len(model.config.id2label), "params", sum(p.numel() for p in model.parameters()))

card_example = "Contact Jane Doe at jane@example.com"
print("card example", detect(model, tokenizer, card_example))

started = time.time()
rows = []
for item in TEXTS:
    # Threshold 0 keeps every span with its score so the threshold can be
    # studied afterwards. The shipped default is 0.5.
    spans = detect(model, tokenizer, item["text"], threshold=0.0)
    tokens = len(tokenizer(item["text"])["input_ids"])
    rows.append({**item, "tokens": tokens, "spans": spans})
elapsed = time.time() - started
print("sentences", len(rows), "seconds", round(elapsed, 2), "max tokens", max(row["tokens"] for row in rows))

Path("/kaggle/working/predictions.jsonl").write_text(
    "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")
print("wrote predictions.jsonl with", sum(len(row["spans"]) for row in rows), "spans")
'''

kernel = Path(__file__).parent / "kernel"
kernel.mkdir(exist_ok=True)
(kernel / "run.py").write_text(RUN.replace("__TEXTS__", json.dumps(texts, ensure_ascii=False)).lstrip(), encoding="utf-8")
(kernel / "kernel-metadata.json").write_text(json.dumps({
    "id": f"{username}/protegrity-pii-korean-check",
    "title": "protegrity-pii-korean-check",
    "code_file": "run.py",
    "language": "python",
    "kernel_type": "script",
    "is_private": True,
    "enable_gpu": False,
    "enable_internet": False,
    "dataset_sources": [f"{username}/protegrity-pii-eval-copy"],
    "competition_sources": [],
    "kernel_sources": [],
}, indent=2), encoding="utf-8")
print("kernel written:", len(texts), "texts")
