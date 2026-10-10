# Security policy

Onyx moves and deletes files on your computer, so security problems are taken seriously.

## Supported versions

Only the latest release gets fixes. Download it from [Releases](../../releases/latest).

| Version | Supported |
| --- | --- |
| 2.8.x | ✅ |
| older | ❌ |

## Reporting a vulnerability

Please **don't** open a public issue. Instead, report it privately through GitHub: go to the **Security** tab of this repository and click **Report a vulnerability**.

Include what you found, how to reproduce it, and what someone could do with it. You'll get a reply within a week, and a fix as quickly as the problem calls for. If you'd like credit when it's fixed, say so in the report.

Things worth reporting include:

- a way to make Onyx move, change or delete files outside the folder that's open
- a way for a file name, folder or extension to run code it shouldn't
- API keys being stored or sent somewhere they shouldn't be
- the build script downloading or running something it didn't verify
