# QBank local demo

A local, account-free SAT Reading and Writing practice app. The bank contains 753 Reading and Writing questions matched by Question ID to the supplied answer key. Questions and choices are native, selectable text; graphs/tables remain images. College Board Math adds 995 questions across Algebra, Advanced Math, Problem-Solving and Data Analysis, and Geometry and Trigonometry. The existing 753 Reading and Writing questions remain unchanged.

## Run

Open **Start QBank.command**, or run `npm start` with Node.js installed. The demo serves only on **http://127.0.0.1:4173**. No application login, registration, external font request, backend account, or cloud synchronization is required. Keep the terminal running while using the demo.

On this computer, the bundled runtime can also start it:

```sh
/Users/muhammadaliravshanzoda/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node serve.mjs
```

## Test setup

Each test contains **1–30 unique questions**, chosen at creation. No stages and no within-test difficulty changes. The default counts are:

| Topic | Questions |
| --- | ---: |
| Information and Ideas | 10 |
| Craft and Structure | 10 |
| Transitions | 3 |
| Standard English Conventions | 5 |
| Rhetorical Synthesis | 2 |
| Total | 30 |

Transitions and Rhetorical Synthesis are grouped together under **Expression of Ideas** in the builder, with separately editable counts. Edit each count, expand a topic to select its underlying skills, or use **Reset default mix**. Availability is calculated from the current question mode and selected skills. All / Unused / Incorrect / Marked modes are supported. Incorrect uses the latest outcome for each question and includes omitted questions. Questions never duplicate within one test.

Timed applies to the entire test (default 35 minutes). Tutor gives feedback after submitting an individual answer; Test mode reveals feedback after finishing. Timer hiding, notes, highlighting, marking, option elimination, direct question navigation, pause/resume, and saved progress are available. An active timed test keeps counting while its tab is hidden; Pause explicitly stops it. Navigating back to the builder pauses the test. Reopening an unpaused timed test accounts for elapsed time.

## Smart selection

Difficulty is **automatic**, with no user difficulty control. The initial target is 25% Easy / 50% Medium / 25% Hard. After at least 10 test-mode questions, the latest 90 test-mode outcomes gradually adjust that mix. Ten prior observations at 70% accuracy temper small samples. Hard remains between 20% and 40%; Easy remains between 20% and 35%; Medium is the remainder. Topic counts are kept exact. Rounding is reconciled across the whole test while preserving exact topic counts. Tests of at least 3 questions retain Easy and Hard slots when the selected pools permit it. Small tests and scarce pools can differ from the target percentages. Missing difficulty slots are filled within the requested topic, never with unrelated topics.

Question types with repeated errors get extra weight within the user's topic quotas. Unseen questions are favored. Wrong answers become more eligible for review after two days; recently seen questions are downweighted. Tutor results inform skill analytics but do not increase/decrease the difficulty mix. This is an inspectable application heuristic, **not College Board's adaptive algorithm or a validated SAT score model**. See [selection rationale](selection-rationale.md) and [implementation](dist/engine.mjs).

## Analytics

Performance groups results by **domain → skill / question type**, for example **Information and Ideas → Central Ideas and Details (main idea and key details)**. It reports exact correct, incorrect, and omitted counts, accuracy, and practice priorities. Labels require at least 5 answered questions per skill; omissions alone do not establish a weakness. Accuracy uses correct / all presented questions, so omitted questions reduce accuracy while remaining separate from incorrect answers. Counts include repeat attempts across tests; these are not unique-question counts.

**View example analytics** opens 3 clearly labeled synthetic tests. Example data is never added to personal history and never influences question selection. Actual skill and question reports use completed tests saved in this browser only.

Responses, answer changes, per-question time, notes, flags, and optional pointer paths stay in localStorage. Pointer recording is bounded to 1200 points per question, no more than 4 samples per second inside the passage. Movement is not eye tracking and does not establish why an answer is wrong. Error reasons may be entered manually in question review. Export/import completed history as JSON to back it up or transfer between origins/devices. Existing v1 histories are preserved; old active stages are migrated into one block, with an original backup kept in storage.

## Visual references and limitations

The builder follows the publicly accessible [UWorld test-builder demo](https://www.uworld.com/courseapp/usmle/v4/demo/createtest/1): slate sidebar, flat white sections, Tutor/Timed switches, question-mode controls, topic selections and counts. The exam follows the public [Bluebook Reading and Writing screenshot](https://bluebook.collegeboard.org/students/accommodations-assistive-technology/jaws) and [testing tools](https://bluebook.collegeboard.org/students/tools): lavender bars, split passage/answer panes, timer, review marking, option elimination and question menu.

This is a standalone demo with independent branding and the supplied question bank. It is not a pixel-for-pixel reproduction of the complete commercial products; private screens, unrelated UWorld features, official scoring, and proprietary adaptive logic are not reproduced. Arial/system sans substitutes for UWorld's Open Sans, Georgia for exam text. Local Lucide outline icons substitute for source icon fonts. Mobile stacks the exam panes to keep the controls and text usable.

## Hosting status

The user authorized Vercel production hosting on October 31, 2026. A sanitized 61-file static release is prepared in `vercel-release/`, excluding original PDFs, extraction files, screenshots, workspace metadata, and personal history. No credentials were found by the local pattern scan. The public `bank.json` contains all 753 questions, correct answers, and explanations; visitors can download it. The app has no external API dependency, and progress remains in browser localStorage. See `deployment-audit.json` for the release digest and audit scope.

**Deployment pending:** the connector can access the Mukaltin team but project creation returned HTTP 403 (permission denied). The documented CLI fallback is being prepared. No Vercel project or live deployment has been created.

The earlier Sites version remains at its existing private URL. The available Sites connector has no unpublish/delete operation, so its removal could not be completed. This revision was not sent there. The local `.openai/hosting.json` is retained only to identify that existing site, not as permission to deploy.

## Verification

Run `npm test`. The test suite checks exact quotas, the 30-question cap, unique IDs, difficulty balance after strong/weak results, skill filtering, question-mode exhaustion, latest-outcome filtering, analytics counts, scarce-pool fallback, conservative labeling, and weak-skill weighting.

Browser QA evidence and comparison details are recorded in [design-qa.md](design-qa.md).

## College Board Math and UWorld collections

The Create Test library separates College Board and UWorld. College Board has Reading & Writing and Math subject tabs; UWorld is an empty collection awaiting the user’s files. Subject switches reset topic counts; test selection and question-mode counts stay within the selected subject/source. Existing question IDs, history, account storage, and unfinished tests remain compatible.

Math contains 995 unique question IDs matched across all three supplied November 2 PDF exports: 772 multiple-choice and 223 numeric-response questions. Equations, diagrams, choices, and worked explanations use cropped original PDF visuals because the source text layer omits mathematical symbols. Full-size question links allow closer inspection. Images load for the current question; explanations appear only in tutor feedback or completed-test review. Question and answer images are downloadable static assets, like the existing question bank.

Numeric responses accept valid signed numbers, decimals, and fractions. Equivalent numeric forms and the explicitly listed accepted answers are graded consistently in tests, analytics, and Incorrect mode. No expressions are evaluated. History import/export supports numeric answers. `math-import-report.json` records counts and domains. `import_math.py` reproduces the assets from the three supplied files. Run `npm test` for regression and Math checks. Release preparation includes the Math JSON and visual assets; this update does not publish a deployment.
