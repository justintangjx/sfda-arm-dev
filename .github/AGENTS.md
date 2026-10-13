# GitHub Actions

[workflows/checks.yml](workflows/checks.yml) runs `Scaffold checks` for pull requests and pushes to `main`. It calls `pnpm verify --mode check --profile foundation`, the same foundation command used locally. Node comes from `.node-version`, pnpm comes from `package.json`, and dependencies use the frozen lockfile. Playwright installs Chromium and WebKit with their Linux dependencies for desktop and mobile checks through workerd. Firefox is not configured.

The summary step runs with `if: always()` and prints the run summary plus each runner's `*.failure-summary.txt`. Failure summaries contain test names, source locations, projects, attempt numbers and safe reason codes. Raw child output and exception payloads are omitted. These summaries are retained with the verification reports for 30 days.

Actions use reviewed full commit IDs. Pull request code runs through ordinary `pull_request` jobs with read access to repository contents. Checkout credentials are not retained, and checks receive no production secrets. New commits cancel earlier checks for the same pull request or branch. The job has a timeout.

Production deployment remains separate work governed by the [architecture delivery policy](../docs/specs/0001-architecture-environments/index.md). Fixture checks establish browser and Worker behavior. Database permissions, production configuration and live provider readiness need their own evidence.

_Drafted by /sync from the introducing change, worth a quick human pass._
