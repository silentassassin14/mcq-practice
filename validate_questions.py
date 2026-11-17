#!/usr/bin/env python3
import sys
import json
import os

def validate_file(filepath):
    print(f"Validating {filepath}...")
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"ERROR: Invalid JSON: {e}")
        return False

    if not isinstance(data, list):
        print("ERROR: Root element must be a JSON array [ ... ]")
        return False

    letters = ["A", "B", "C", "D"]
    flat = []

    for i, item in enumerate(data):
        n = i + 1
        if isinstance(item, dict) and "questions" in item:
            if not isinstance(item.get("passage"), str) or not item["passage"].strip():
                print(f"Item {n}: Passage set requires non-empty 'passage' string.")
                return False
            if not isinstance(item.get("questions"), list) or not item["questions"]:
                print(f"Item {n}: Passage set requires non-empty 'questions' array.")
                return False
            for j, sub in enumerate(item["questions"]):
                flat.append((f"Item {n} (sub-question {j+1})", sub))
        else:
            flat.append((f"Item {n}", item))

    ids = set()
    errors = 0

    for label, q in flat:
        if not isinstance(q, dict):
            print(f"{label}: Not a JSON object.")
            errors += 1
            continue
        if "question" not in q or not isinstance(q["question"], str) or not q["question"].strip():
            print(f"{label}: Missing or invalid 'question' text.")
            errors += 1
        if "options" not in q or not isinstance(q["options"], dict):
            print(f"{label}: Missing 'options' object.")
            errors += 1
        else:
            if sorted(q["options"].keys()) != letters:
                print(f"{label}: 'options' must have exactly keys 'A', 'B', 'C', 'D'. Found {list(q['options'].keys())}")
                errors += 1
            else:
                for l in letters:
                    if not isinstance(q["options"][l], str) or not q["options"][l].strip():
                        print(f"{label}: Option {l} is empty or not a string.")
                        errors += 1
        if "answer" not in q or q["answer"] not in letters:
            print(f"{label}: 'answer' must be one of 'A', 'B', 'C', 'D'. Found {q.get('answer')}")
            errors += 1
        if "id" in q:
            try:
                qid = int(q["id"])
                if qid in ids:
                    print(f"{label}: Duplicate ID #{qid}")
                    errors += 1
                ids.add(qid)
            except ValueError:
                print(f"{label}: ID '{q['id']}' is not an integer.")
                errors += 1

    if errors == 0:
        print(f"SUCCESS: {filepath} is valid! ({len(flat)} total questions checked).")
        return True
    else:
        print(f"FAILED: Found {errors} error(s).")
        return False

if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "questions.json"
    success = validate_file(target)
    sys.exit(0 if success else 1)
