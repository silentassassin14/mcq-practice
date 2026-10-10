[question_bank_guidelines.md](https://github.com/user-attachments/files/33282866/question_bank_guidelines.md)
# Question-bank JSON: guidelines for both formats

One file, `questions.json`, can hold **two kinds of items** mixed in any order:

| Kind | Use it for | Looks like |
|---|---|---|
| **A. Plain question** | A normal stand-alone MCQ | `{ id, question, options, answer }` |
| **B. Passage set** | One main passage / data table with several sub-questions that must all stay on screen with it | `{ group, title, passage, questions: [ ... ] }` |

Files in this guide:
- `questions_template_both_formats.json` is a ready template with both kinds, already valid.
- `validate_questions.py` checks any file against these rules: `python validate_questions.py questions.json`.

---

## 1. Rules for the whole file

1. The file is **one JSON array** `[ ... ]`. Items are separated by commas.
2. Valid JSON only: double quotes for keys and text, **no trailing commas, no comments**. Save as UTF-8.
3. **Every question has an `id`**, including sub-questions inside a set. IDs are whole numbers, **unique**, and run `1, 2, 3 ...` **in the order they appear in the file**. A set itself has no `id`; its sub-questions continue the numbering.
4. **Every question has exactly four fields**: `id`, `question`, `options`, `answer`. No extra fields.
5. `options` has **exactly four keys**: `"A"`, `"B"`, `"C"`, `"D"`, each a non-empty string. No two options with the same text.
6. `answer` is **one capital letter**: `"A"`, `"B"`, `"C"` or `"D"`. Exactly one option must be correct.
7. Text is **plain text**. HTML tags are shown literally, so don't use them. Use Unicode where needed: `m²`, `m⁴`, `₹`, `°C`, `→`, `×`, `÷`.
8. Inside a JSON string, write a line break as `\n` (never press Enter), a double quote as `\"`, and a backslash as `\\`.

> The app fills in missing ids by itself, but always write them. It keeps Edit and Delete by ID predictable.

---

## 2. Format A: plain question

```json
{
  "id": 1,
  "question": "Which of these is the SI unit of pressure?",
  "options": {
    "A": "Pascal",
    "B": "Joule",
    "C": "Newton",
    "D": "Watt"
  },
  "answer": "A"
}
```

---

## 3. Format B: passage set

```json
{
  "group": "ocean-currents",
  "title": "Directions (Q1–3): Read the passage and answer the questions",
  "passage": "First paragraph.\n\nSecond paragraph.",
  "questions": [
    {
      "id": 2,
      "question": "According to the passage, what mainly drives the thermohaline circulation?",
      "options": { "A": "Wind stress", "B": "Differences in water density", "C": "Tides", "D": "Magnetism" },
      "answer": "B"
    },
    {
      "id": 3,
      "question": "Which kind of current is organised into large gyres?",
      "options": { "A": "Thermohaline", "B": "Deep-water", "C": "Wind-driven", "D": "Tidal" },
      "answer": "C"
    }
  ]
}
```

| Field | Required? | Rule |
|---|---|---|
| `group` | Yes | A short unique name for the set, e.g. `"ocean-currents"` (lowercase, hyphens, no spaces). No two sets share a name. |
| `title` | No | The heading above the passage, e.g. `"Directions (Q1–5): Read the passage..."`. If omitted, the heading is "Passage". |
| `passage` | Yes | The main text. **Write it once.** Never copy it into the sub-questions. |
| `questions` | Yes | A list of one or more normal questions (Format A without any extra fields). Their order in the file is the order the student sees them. |

Do **not** put `group` or `passage` inside a sub-question. The set already provides them.

**What the student sees:** the passage stays on screen (side panel on a computer, pinned at the top on a phone) for every sub-question of the set. The sub-questions come one after another in file order. In a full quiz, whole sets and plain questions are shuffled as units, so a set is never split.

---

## 4. Writing tables (data sets and "match the following")

Any line that starts with `|` becomes a table. This works in both `passage` and `question`.

```
| Station | Temperature (°C) | Salinity (psu) |
|---|---|---|
| S1 | 28 | 34 |
| S2 | 24 | 35 |
```

As a JSON string, with `\n` between the lines:

```json
"passage": "The table shows the readings at two stations.\n\n| Station | Temperature (°C) | Salinity (psu) |\n|---|---|---|\n| S1 | 28 | 34 |\n| S2 | 24 | 35 |\n\nNote: psu = practical salinity unit."
```

- Every row goes on its own line and starts with `|`.
- A `|---|---|` line right after the first row makes that row a header.
- Every row has the **same number of columns**.
- Leave a blank line (`\n\n`) before and after the table.
- A cell cannot contain a `|` or a line break.

A **data table shared by several questions** is a passage set. The table goes in `passage` once and each question goes in `questions`.

---

## 5. Converting common exam patterns

| Pattern in the paper | How to write it |
|---|---|
| Passage with Q1–Q5 | Format B. The directions line goes in `title`, the passage text in `passage`. |
| One data table with 5 questions | Format B. The table goes in `passage` as in section 4. |
| Match List I with List II | Format A. The table goes inside `question`. Options are the codes: `"A-2, B-1, C-4, D-3"`. |
| Arrange in correct order | Format A. Put the items on separate lines in `question`: `"...\nA. First item\nB. Second item"`. Options are the sequences: `"D, A, B, E, C"`. |
| Statement I / Statement II | Format A. Each statement on its own line (`\n`) inside `question`. |
| Assertion (A) / Reason (R) | Format A. Same as above, with the standard four options written out in full. |
| Question that needs a picture | Not supported. Describe it in words, or leave it out. |

---

## 6. Options are shuffled every attempt

The app shuffles the options each time a question is shown. These therefore break and must be rewritten:

- Options that refer to other options: `"All of the above"`, `"None of the above"`, `"Both A and B"`, `"Options (a) and (c)"`. Write full statements instead.
- Question text that mentions option letters: `"Choose between (a) and (c)"`.
- Options that start with their own letter: `"(a) Pascal"` or `"A. Pascal"`. The app adds the letter itself, so write just `"Pascal"`.

Codes such as `"A-2, B-1, C-4, D-3"` are fine. The letters there refer to list items, not to option letters.

---

## 7. Common mistakes

| Mistake | Fix |
|---|---|
| Comma after the last item or last field | Remove it. |
| `"answer": "b"` or `"answer": "(b)"` | `"answer": "B"` |
| Only 3 options, or option keys `1, 2, 3, 4` | Exactly `"A"`, `"B"`, `"C"`, `"D"`. |
| Real line break inside a string | Use `\n`. |
| Straight quote inside text, e.g. `"the "Red Herring" fallacy"` | `"the \"Red Herring\" fallacy"` |
| Same passage repeated in every sub-question | One set with the passage written once. |
| IDs restarting at 1 inside each set | IDs run through the whole file: 1, 2, 3 ... |
| Two sets with the same `group` | Give each set its own name. |
| Extra fields such as `"explanation"` or `"topic"` | Not allowed. Remove them. |

---

## 8. Check the file before using it

1. Run `python validate_questions.py questions.json`. It lists every error with the item number, plus advice (warnings).
2. Optionally, log in as admin, open **Publish to Blog → Choose JSON file**. This previews the file and shows the item number of any problem.
3. Put the finished file next to `index.html` as `questions.json`, or paste it through your usual Blogger publish steps.

---

## 9. Copy-paste prompt for an AI

Use this when you ask an AI to turn a question paper into JSON. Replace the last line with your content.

```text
Convert the question paper below into ONE JSON file for my quiz app.

FILE
- A single JSON array [ ]. Valid JSON: double quotes, no trailing commas, no comments.
- Items are either PLAIN questions or PASSAGE SETS, in the same order as the paper.

EVERY QUESTION (plain, or inside a set) has EXACTLY these four fields:
  "id": integer, unique, 1,2,3... in file order (sub-questions inside sets continue the numbering)
  "question": string
  "options": object with exactly the keys "A","B","C","D", each a non-empty string
             (do NOT start an option with "A." or "(a)")
  "answer": one capital letter "A"-"D". Exactly one correct answer.
No other fields.

PLAIN QUESTION:
{ "id": 1, "question": "...", "options": {"A":"...","B":"...","C":"...","D":"..."}, "answer": "B" }

PASSAGE SET (use it when several questions share one passage or one data table):
{
  "group": "short-unique-name",
  "title": "Directions (Q1-5): Read the passage and answer the questions",
  "passage": "Passage text. Write it ONCE.",
  "questions": [ { "id": 2, "question": "...", "options": {...}, "answer": "C" }, ... ]
}
A set has no "id". Do not put "group" or "passage" inside its questions.

TEXT RULES
- Plain text only (no HTML). Use Unicode for math and symbols: m², ₹, °C, →.
- Line breaks inside strings are \n. Escape double quotes as \".
- Tables: each row on its own line starting with |, second line |---|---|, same number of
  columns in every row, a blank line before and after, written as \n inside the string.
  Use this for data tables (put them in "passage") and for match-the-following tables
  (put them in "question"; options are codes such as "A-2, B-1, C-4, D-3").
- Options are shuffled by the app: never write "All of the above", "Both A and B",
  or refer to option letters in the question or in another option.
- For arrange-in-order questions, put the items on separate lines (\n) in the question.

Return only the JSON.

QUESTION PAPER:
<paste the questions and answers here>
```
