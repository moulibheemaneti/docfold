# Contributing to docfold

Thanks for taking the time to contribute! Please read this guide before opening an issue or pull request.

## Getting started

**Prerequisites:** [Bun](https://bun.sh) ≥ 1.4.0.

```sh
git clone https://github.com/moulibheemaneti/docfold.git
cd docfold
bun install
```

docfold runs straight from its TypeScript sources, so there is no build step. To try your change on a folder of markdown:

```sh
bun src/cli.ts dev   path/to/docs   # dev server on http://localhost:3000
bun src/cli.ts build path/to/docs   # static site in path/to/docs/dist
```

## Commit convention

Pull requests are squash-merged, and the PR title becomes the commit message on `master`. Titles must follow [Conventional Commits](https://www.conventionalcommits.org/) (a check enforces this):

```
<type>: <subject starting with a lowercase letter>
```

Allowed types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `test`, `build`, `ci`, `perf`, `revert`.

Examples:

```
feat: add a date range filter
fix: keep the sidebar open on deep links
docs: explain the base option for GitHub Pages
```

The type decides the next version: `fix` is a patch release, `feat` a minor one, and a `!` after the type (`feat!:`) or a `BREAKING CHANGE:` footer a major one.

## Running tests

```sh
bun test
bun run typecheck
```

## Making a change

1. Fork the repo and create a branch from `master`.
2. Make your changes and add or update tests as needed.
3. Run `bun run typecheck`: it must pass with zero type errors.
4. Run `bun test`: all tests must pass.
5. Update `README.md` if you changed behaviour, configuration or the CLI.
6. Open a pull request with a Conventional Commits title.

You don't need to edit `CHANGELOG.md` or bump the version in `package.json`. [release-please](https://github.com/googleapis/release-please) does both in its release pull request, from the commit messages on `master`.

## Reporting issues

Use the issue templates — they ask for the specific information needed to reproduce or triage your report quickly. For security vulnerabilities, see [SECURITY.md](SECURITY.md).

Please note that this project follows a [Code of Conduct](CODE_OF_CONDUCT.md). By participating you agree to abide by its terms.
