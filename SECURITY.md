# Security Policy

## Supported Versions

Only the latest minor release of `docfold` receives security fixes.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

`docfold` turns a folder of markdown into a static site. It reads files from
disk, runs a local dev / preview server, and writes HTML — it does not handle
authentication or store user data. That said, if you believe you've found a
vulnerability (for example, the dev or preview server serving files outside the
docs folder or hidden paths such as `.env`, `docfold build` copying such files
into the output, or a problem in a transitive dependency exposed via this
package), please **do not open a public issue**.

Report it privately via GitHub Security Advisories:

➡️ [Report a vulnerability](https://github.com/moulibheemaneti/docfold/security/advisories/new)

You can expect:
- An acknowledgement within **7–14 days**.
- A status update within **30–45 days**.
- If accepted, a fix will land in the next patch release and you'll be credited in the release notes (unless you prefer to remain anonymous).
- If declined, you'll receive an explanation of why.

## Out of scope

docfold trusts the content it is given. These are expected behaviour, not vulnerabilities:

- `docfold.config.ts` is code and runs with your permissions when docfold loads it.
- HTML written in a markdown file is passed through to the generated page as-is.
- `docfold dev` and `docfold preview` are for local use; they are not hardened for exposure to the internet. Deploy the output of `docfold build` instead.
