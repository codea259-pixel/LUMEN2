# Reviewing assessment questions

Use this checklist whenever questions are added or changed (a new grade, a trimester's new versions, a teacher's report).
The reviewer should be someone other than the writer. Read the format first: the note at the top of tools/build_assess.py
and WRITING.md. In `mcN:` lines the first choice is the correct one (the site shuffles them).

Read every item and actually work it out: do the arithmetic, re-read the passage, check the facts. Fix real problems with
the smallest edit that makes the item right:
1. Wrong key: a num answer that is wrong; an mc whose first choice is not correct; an mc where a second choice is also
   correct or defensible (watch for equal values written differently, such as 4/3 and 1 1/3, or 1 7/4 and 2 3/4);
   a sample answer that is wrong or contradicts the key.
2. Factual errors (science, history, geography, civics, dates, names, quotations).
3. A question that cannot be answered from what it gives (missing numbers, unclear units or endpoints), is ambiguous,
   or depends on another question. Questions are drawn one at a time into benchmarks, so each must stand alone.
4. ELA: a key the passage does not support, or a question about something not in its passage.
5. Something clearly far above or below the grade (for example unlike-denominator fractions in grade 2).
6. Text copied from a publisher or other copyrighted work (Eureka Math, Benchmark Advance, Collections, Mystery Science,
   Discovery Education, textbooks, modern poems or songs). Short public-domain quotations are fine. Replace copied text
   with original text of the same length and purpose.
Do not rewrite for style, and do not change the number or kind of items. Keep characters Latin-1 and never put `|` in a field.

Then run `python3 tools/build.py` (must end with "assessments ok") and `node tools/validate-assess.cjs` (must end with
"no problems"; it builds, grades and prints every lesson, test, benchmark and version).
