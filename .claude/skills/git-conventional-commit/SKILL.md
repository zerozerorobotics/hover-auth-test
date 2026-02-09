---
name: git-conventional-commit
description: >
  Use this skill to analyze the current git diff, ask the user for intent if needed,
  generate a Conventional Commits formatted message, confirm it, and then run git commit.
  Trigger when the user says "commit", "git commit", "帮我写 commit 信息", or wants to submit code changes.
---

# Git Conventional Commit Skill

## Goal

Help the user create and apply a **Conventional Commits** style git commit message for the current repository changes, then run `git commit` with that message once the user confirms.[web:30]

The commit message MUST follow this structure:[web:24][web:30]

- `type[optional scope]: description`
- Optional body
- Optional footer(s)

Common `type` values include `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, etc.[web:30]

## When to use this skill

Use this skill when:

- The user mentions committing changes, e.g. "commit", "git commit", "提交代码", "帮我写 commit 信息".
- Work in the current branch is ready to be committed.
- The user asks why certain changes were made and wants that reflected in the commit message.[web:31]

Do NOT use this skill when:

- There are no changes in the working tree or staging area.
- The user only wants to review changes without committing.

## Required tools / capabilities

To execute this skill effectively, you should be able to:

- Run shell commands in the project root (e.g. `git status`, `git diff`, `git commit`).[web:25]
- Read and analyze the output of `git diff` and `git status` to understand what changed.
- Interactively ask the user clarifying questions.

If you cannot run shell commands, you MUST stop after generating and showing the commit message, and explicitly tell the user how to run the commit command manually.

## Step-by-step instructions

Follow these steps strictly and sequentially:

1. **Check git status**

   - Run: `git status --short` to confirm there are staged or unstaged changes.[web:25]
   - If there are no changes, explain to the user that there is nothing to commit and stop.

2. **Inspect the diff**

   - Run:  
     - `git diff --cached` to view staged changes.  
     - If empty and there are unstaged changes, ask the user whether to commit unstaged changes, and if yes, run `git add` as appropriate (for example `git add .` or a more precise list based on user input).[web:25]
   - Briefly summarize what changed in natural language (files touched, main types of changes).

3. **Infer likely intent and ask user to confirm**

   - Based on the diff, infer likely intent categories:  
     - "Add new feature" → `feat`  
     - "Fix bug" → `fix`  
     - "Refactor code" (no behavior change) → `refactor`  
     - "Docs only" → `docs`  
     - "Tests only" → `test`  
     - "Chores / tooling" → `chore`.[web:30][web:27]
   - Present 3–5 concrete options describing WHY these changes were made and map each to a `type` and an optional `scope`.  
   - Always include an "Other (custom explanation)" option where the user can type their own reasoning.[web:31]
   - Wait for the user to choose one option or provide a custom explanation.

4. **Determine `type`, optional `scope`, and `description`**

   - From the chosen intent, decide the `type` and suggest an optional `scope` (e.g. `api`, `ui`, `build`, `docs`, etc.).[web:30]
   - Ask the user to confirm or edit:
     - `type`: one of `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, etc.
     - `scope`: short noun describing the affected area, or leave blank.
     - `description`: a concise, imperative, lower‑case summary of the change (e.g. "add user login form validation").[web:30][web:28]

5. **Construct the Conventional Commit header**

   - Build the header line as:  
     - If there is scope: `type(scope): description`  
     - If no scope: `type: description`.[web:24][web:30]
   - Do not exceed ~72 characters for the description where feasible.[web:28]

6. **Generate optional body and footers**

   - If the user provided a longer explanation (e.g. "why this change was needed", "what changed", "side effects"), turn it into a multi‑line body separated from the header by one blank line.[web:24][web:28]
   - If the user mentions issue IDs (e.g. `PROJ-123`, `#456`), add them as footers after another blank line, using a format like:
     - `Refs: PROJ-123`
     - `Fixes: #456`.[web:24][web:28]
   - The final message format MUST be:

     ```text
     type(scope): short description

     [optional body paragraphs]

     [optional footer lines]
     ```

7. **Show the final commit message for confirmation**

   - Display the exact commit message that will be used, inside a fenced code block.
   - Ask the user:  
     - "Do you approve this commit message and want me to run `git commit` with it?"  
   - If the user wants changes, edit the message accordingly and show the updated version again.

8. **Run git commit (if allowed)**

   - If the environment supports shell execution and the user has approved:
     - For single‑line header only, run:  

       ```bash
       git commit -m "type(scope): short description"
       ```[web:25]

     - For multi‑line messages, use a heredoc pattern like:

       ```bash
       git commit -m "$(cat <<'EOF'
       type(scope): short description

       [body]

       [footers]
       EOF
       )"
       ```[web:31]

   - After running the command, show the output of `git status --short` so the user can confirm the working tree is clean or see remaining changes.

9. **If you cannot run git commands**

   - If shell access is not available, stop after step 7.
   - Clearly instruct the user to run the exact `git commit` command locally using the generated message.

## Output format

When executing this skill, always:

1. Summarize the detected changes.
2. Show the final commit message in a fenced code block.
3. Explicitly confirm whether `git commit` has been executed, and if yes, show brief status.
4. If not executed, give the exact command the user should run.

## Notes and best practices

- Prefer precise scopes (e.g. `auth`, `api`, `docs`, `ci`) when they make the history easier to understand.[web:30][web:27]
- Use English for `type` and `scope`, but the `description` and body can be in Chinese or English depending on the repository convention.[web:27][web:28]
- Avoid mixing unrelated logical changes into a single commit; if the diff contains multiple independent changes, suggest splitting them into separate commits.
