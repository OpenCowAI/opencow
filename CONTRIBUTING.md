# Contributing to OpenCow

Thank you for your interest in contributing to OpenCow! This guide will help you get started.

## Table of Contents

- [Development Setup](#development-setup)
- [Code Style](#code-style)
- [Commit Message Format](#commit-message-format)
- [Pull Request Process](#pull-request-process)
- [Testing](#testing)
- [Code Review](#code-review)
- [Reporting Issues](#reporting-issues)

## Development Setup

1. **Fork and clone** the repository:

   ```bash
   git clone https://github.com/<your-username>/OpenCow.git
   cd OpenCow
   ```

2. **Install dependencies** using [pnpm](https://pnpm.io/):

   ```bash
   pnpm install
   ```

3. **Start the development server:**

   ```bash
   pnpm dev
   ```

For additional project setup details, see the [README](./README.md).

## Code Style

- **TypeScript** is used throughout the project with strict mode enabled.
- **Prettier** handles code formatting. Run `pnpm format` to format your code.
- **ESLint** enforces linting rules. Run `pnpm lint` to check for issues.
- Keep functions small and focused. Prefer explicit types over `any`.
- Use meaningful variable and function names.

Your editor should pick up the project's Prettier and ESLint configurations automatically. Please ensure there are no linting errors or formatting issues before submitting a pull request.

## Commit Message Format

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification. Each commit message should be structured as:

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

**Types:**

| Type       | Description                                      |
|------------|--------------------------------------------------|
| `feat`     | A new feature                                    |
| `fix`      | A bug fix                                        |
| `docs`     | Documentation changes only                       |
| `style`    | Formatting, missing semicolons, etc. (no logic)  |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf`     | Performance improvement                          |
| `test`     | Adding or updating tests                         |
| `chore`    | Build process, tooling, or dependency updates    |

**Examples:**

```
feat(editor): add syntax highlighting for markdown
fix(sidebar): prevent crash when project list is empty
docs: update contributing guide with testing section
```

## Pull Request Process

1. **Create a feature branch** from `main`:

   ```bash
   git checkout -b feat/my-feature
   ```

2. **Make your changes** with clear, atomic commits following the commit message format above.

3. **Ensure all tests pass** and there are no linting errors:

   ```bash
   pnpm test
   pnpm lint
   ```

4. **Push your branch** and open a pull request against `main`.

5. **Fill out the PR template** completely, including a summary of changes, type of change, and testing details.

6. **Address review feedback** promptly. Push additional commits rather than force-pushing, so reviewers can see incremental changes.

7. Once approved, a maintainer will merge your PR.

## Testing

- We use [Vitest](https://vitest.dev/) as our test framework.
- Write tests for all new features and bug fixes.
- Run the test suite with:

  ```bash
  pnpm test
  ```

- Aim for meaningful test coverage. Focus on testing behavior rather than implementation details.
- Place test files alongside the source code they test, using the naming convention `*.test.ts` or `*.test.tsx`.

## Code Review

All submissions require review before merging. Here is what reviewers look for:

- **Correctness** -- Does the code do what it claims?
- **Clarity** -- Is the code easy to read and understand?
- **Test coverage** -- Are there adequate tests for the changes?
- **Performance** -- Are there any obvious performance concerns?
- **Consistency** -- Does the code follow existing patterns and conventions?

Be respectful and constructive in code reviews. We are all here to learn and improve.

## Reporting Issues

Before opening a new issue, please search existing issues to avoid duplicates.

When reporting a bug, include:

- A clear and descriptive title.
- Steps to reproduce the issue.
- Expected behavior vs. actual behavior.
- Your environment details (OS, Electron version, Node.js version).
- Screenshots or logs, if applicable.

For feature requests, describe the problem you are trying to solve and your proposed solution.

Use the provided [issue templates](https://github.com/OpenCowAI/opencow/issues/new/choose) when available.

---

Thank you for contributing to OpenCow!
