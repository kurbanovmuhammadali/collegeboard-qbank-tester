# QBank

**Turn SAT questions into focused practice.**

QBank helps SAT learners build a manageable study routine: choose a subject, create a short test, review your reasoning, and return to the skills that need more attention.

This independent practice app brings Reading & Writing and Math into one workspace, with separate College Board and UWorld collections.

## Practice with a purpose

- **Choose your focus.** Build tests of 1–30 questions with your own topic counts and skill selections.
- **Study at your pace.** Use Tutor mode for feedback after each response, or Test mode to review everything when you finish. Practice with or without a timer.
- **Return to useful questions.** Filter for unused, incorrect, or marked questions, and keep notes for later review.
- **Learn from your results.** Review completed tests and see College Board performance by domain and skill, with incorrect answers and omissions shown separately.

## Two collections, one study space

### College Board

Practice with **753 Reading & Writing questions** and **995 Math questions**. Math covers Algebra, Advanced Math, Problem-Solving and Data Analysis, and Geometry and Trigonometry.

Original Math equations, diagrams, and worked explanations remain available as visuals, with full-size views for closer inspection. Numeric responses support numbers, decimals, and fractions.

### UWorld · draft answer preview

Explore **1,743 source pages** across Reading & Writing and Math, with original question screenshots alongside the draft solutions. Independently generated answers and explanations are clearly marked **draft — needs review**; they are not an official UWorld answer key.

Draft results are provisional and kept separate from College Board performance and automatic difficulty adjustments. Screenshots with missing information remain flagged for source review.

## Start with one session

In the app, choose your collection and subject, set your topic counts, and generate a test. Afterward, open **Previous Tests** to review your answers and plan your next session.

QBank is an independent practice tool, not affiliated with College Board or UWorld. Its practice results are not official SAT scores.


## Personal error logs

After submitting an answer in Tutor mode, or opening a question from a finished test’s results, use **Your error log** to describe the mistake and click **Save error log**. You can optionally pick or write an error type yourself. Clear the text and save to remove a log.

Open **Error Logs** in the dashboard sidebar. Select an error type to see the original notes and their question attempts, then choose **Review question** to open the passage, answers, and explanation. Existing error-reason selections appear here too. Logs are saved inside the original test history, so existing account sync and history export/import include them without a database migration. Each attempt is kept separately, even when the same question appears in several tests.

### Connect Gemini grouping

Manual logging works immediately. To enable semantic grouping, add `GOOGLE_GENERATIVE_AI_API_KEY` as a **server-only** environment variable in the Vercel project, then redeploy. `GEMINI_MODEL` optionally selects a model available to the key; the default is `gemini-4-argon`. See `.env.example` for the settings. Never add the key to `dist/config.js`, commit it to Git, or expose it in a browser field.

Signed-in users can choose **Group with Gemini** to group existing logs; newly saved logs are grouped automatically when available. Similar wording is assigned to a shared type, while the original note is preserved. A type chosen manually is kept fixed. Tutor logs can be grouped after finishing the test. Only note text and existing type labels are sent to Gemini; passages, answers, and explanations are excluded. Grouping requires account authentication. API failures leave all written logs saved and can be retried from Error Logs.

The endpoint is a Node.js Vercel Function at `/api/error-log-groups`; static hosting alone supports manual logging. It verifies the existing Supabase account token and validates request limits and complete model assignments. For another account backend, configure `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` alongside the browser’s public config. No service-role key is required.

Run `npm ci` and `npm test` to verify grouping, persistence, legacy reasons, manual overrides, stale edits, authentication, and provider failures. Browser checks should also cover post-submission logging, category navigation, refreshing, editing/removal, and narrow screens. Gemini responses require a real configured API key to verify live.
