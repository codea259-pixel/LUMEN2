# Writing Learn-only lessons

Learn-only lessons give a skill that has no test-bank unit (computer science, financial literacy, Spanish and some
college-level core topics) a full set of short, progressive lessons. They appear in the lesson library: a search for
the skill and the skill's own page list them in order. They have practice items only, with no quizzes or unit tests.

The line format is at the top of `tools/build_lessons.py`. Check your file with `python3 tools/build_lessons.py`. It
must end with `learn lessons ok`. Fix every problem it lists. The rules in `tools/assess-src/WRITING.md` ("Rules that
are not negotiable") apply here too.

## Shape of a unit
- 5 lessons a unit (up to 8 for a big topic). Order them from easiest to hardest:
  1. the core idea and its words;
  2. recognising and sorting examples;
  3. using it in a guided way, with worked thinking in the hints;
  4. mixed practice that targets common mistakes;
  5. applying it to a new, real-world situation (the hardest DOK 2–3 items go here).
- Each lesson has 5 or 6 items: mostly `mc` and `num`, at most one `sa`. Most items have a `hint:` line.
- Every item stands alone. Never write "the code above" or "in the last question". Repeat whatever it needs.
- No question repeats within a unit. Don't copy the facts in the skill's study sheet word for word. Teach around them
  and beyond them.

## Good items
- **Multiple choice:** the correct answer comes first in the line (the app shuffles the choices). The three wrong
  choices are believable mistakes a learner really makes, all different and all clearly wrong. Never use "all of the
  above" or "none of the above".
- **Numbers:** `num` answers are one exact number (24, -3, 2.5, 3/4). Work every answer out twice.
- **Hints** guide thinking ("What does each 1 in binary stand for?"). They never contain the answer.
- **Short answers** (`sa`) give a model answer the learner compares with their own.
- **Level:** match the grade. TK to 1 items are short and meant to be read aloud, with one- or two-word choices.
  Grade 13 means early college.

## Accuracy and safety
- Every fact must be correct and current. If you are not sure of a fact, leave it out. Don't state prices, rates,
  limits or laws that change from year to year as if they were fixed. Say "for example" and use round numbers.
- Everything is original. Don't copy text from any textbook, course or website.
- No brand names, products, apps, companies or real people's private details. Use made-up names from many cultures.
- Online-safety lessons teach children to stop, not share, and tell a trusted adult. Nothing frightening.
- Money lessons teach ideas, not advice to buy a product. Use US dollars and round example numbers.
- Spanish: standard, neutral Latin American Spanish with correct accents (á é í ó ú ñ ü ¿ ¡ are fine).
- Code: write code inside a question on one line, for example `x = 5; print(x + 2)` or "a loop that repeats 3 times".
  Use Python 3 unless the lesson is about another language. Never use the `|` character (write "or").
- Plain characters only: straight quotes ' and ", hyphens instead of long dashes, no emoji.
