# Writing assessment content

Read this, the rules at the top of `tools/build_assess.py`, and `tools/assess-src/v2-example.txt` (a complete unit) before writing.

## Where content goes
- One file per subject and grade: `tools/assess-src/v2/<subject>-<grade>.txt`, for example `v2/math-3.txt`, `v2/ela-TK.txt`, `v2/sci-7.txt`, `v2/soc-5.txt`.
- A `v2` file replaces that grade's older content in `tools/assess-src/<subject>.txt`. You may reuse good items from the older file, but every item must fit the new structure and no question may repeat within a unit.
- Check your work with `python3 tools/build_assess.py`. It must end with `assessments ok`. Fix every problem it lists.
- Commit only your own `v2` files (`git add tools/assess-src/v2/<file>`). Do not commit `server/assessments.json`, `app.html` or anything else.

## Size of each grade
- Units follow the district program's units or modules, in order (see your assignment).
- Each unit has 3 to 5 lessons (2 to 6 allowed). Each lesson has:
  - **practice** (classwork): 5 or 6 items, most with a `hint:` line. Hints guide thinking and never give the answer.
  - **quiz**: 7 or 8 items, at least 5 scored automatically (mc or num) and at least 1 written (sa, or cer or wr where it fits).
- Each unit has a **unit test** of 22 to 25 items: about 17 to 19 automatic items, 2 or 3 short answers, and one 4-point item (task for math, wr for ELA, cer for science and social studies). Mix DOK 1, 2 and 3; at least a quarter should be DOK 2 or 3.
- Quiz and test questions must be new questions, not copies of practice items with small changes.
- Every question must stand alone, because benchmarks draw questions separately: repeat the facts or data it needs instead of writing "In that vote..." or "Using the same graph...". Questions about a reading passage use `passage:` lines instead.

## What good items look like
- **Math:** many real-world word problems (`num` items with one exact number answer), multi-step problems at DOK 3, error analysis ("Sam says... explain his mistake"), and a performance task in every unit test. Work out every answer twice.
- **ELA:** original reading passages written for the grade (TK to 1: 40 to 120 words, written to be read aloud; 2 to 3: 150 to 300 words; 4 to 8: 250 to 500 words). Use both literary and informational passages. Ask about main idea, details, inference, vocabulary in context, author's purpose, text structure, theme and character, and include grammar, conventions and phonics or word study for the grade. Every unit test has one or two passages with 8 to 12 questions and a `wr` writing response that uses the passage. Use `//` for paragraph breaks.
- **Science:** phenomena, investigations and data ("A student measured... which conclusion is supported?"), models and diagrams described in words, and a `cer` (claim, evidence, reasoning) item in every unit test, plus CER in some lesson quizzes. Give the data the student needs inside the question.
- **Social studies:** maps, timelines and sources described in words; short excerpts from public-domain primary sources (for example, documents written before 1929) with the author and date; cause and effect; multiple perspectives; and a `cer` item in every unit test.
- **TK to grade 1:** short, simple items meant to be read aloud. Describe pictures and objects in words. Answer choices should be one or two words or a number.
- **Supports:** add an `el:` line to each unit with one practical support for English learners.

## Rules that are not negotiable
- Everything is original. Never copy or closely paraphrase questions, passages or text from any publisher or program (Eureka Math, Benchmark Advance, Collections, Mystery Science, Discovery Education or others). Following a program's unit order and topics is fine; its words are not.
- Every answer must be correct. For multiple choice, the correct answer comes first in the line; the app shuffles the choices. Wrong answers should be believable mistakes, not silly ones, and every choice must be different.
- Facts must be accurate and grade-appropriate. If you are not sure of a fact, leave it out.
- Plain characters only (Latin-1): straight quotes ' and ", hyphens instead of dashes, x for times and / for divide (or the symbols in Latin-1: x, ÷, ×, °, ½). Never use the character `|` inside text (write absolute value as abs(x)).
- Respect every student: no stereotypes; use a variety of names, families and communities from California and the world.

## New questions each trimester
Each trimester gets a new set of unit tests and lesson quizzes, so a class does not see last year's questions. The
standard questions stay; the new set is an extra version that the site picks first during its trimester (teachers can
still choose any version when they preview or assign).
- **Which units:** the units taught that trimester. Split each grade's units in order into thirds: with N units, unit i
  (counting from 1) is in trimester min(3, floor((i - 1) x 3 / N) + 1). With 6 units that is 1-2, 3-4 and 5-6.
- **What to write:** for each of those units, a new unit test and a new quiz for every lesson (classwork stays).
  Same sizes and mix as above, same standards, lessons and difficulty, but new questions, numbers, contexts and passages.
  Do not copy or lightly edit questions from the standard version or from earlier trimesters' files; the compiler
  rejects exact copies.
- **Where:** one file per subject and grade, `tools/assess-src/versions/<year>-t<n>-<subject>-<grade>.txt`, for
  example `versions/2026-t2-math-3.txt` or `versions/2027-t3-ela-tk.txt` (lowercase; the year is the one the school
  year starts in). Start it with `@version 2026-27 Trimester 2 | Trimester 2`. The term after `|` must match the
  trimester's name in the site's calendar (Teacher > Assessments > Set trimester dates). Then one `@for` block per part:
  `@for math-3-4 test` or `@for math-3-4 L2 quiz` (unit ids are listed in `server/assessments.json`; TK is -1 and K is 0,
  so TK math unit 2 is `math--1-2`).
- **Check:** have someone other than the writer review every file with `REVIEW.md`, then run `python3 tools/build.py`
  (must end with `assessments ok`) and `node tools/validate-assess.cjs` (must end with `no problems`).
