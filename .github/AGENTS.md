# GitHub Actions

[workflows/checks.yml](workflows/checks.yml) runs `Scaffold checks` for pull requests and pushes to `main`. It calls the same `pnpm check` command used locally. Node comes from `.node-version`, pnpm comes from `package.json`, and dependencies use the frozen lockfile. Playwright installs Chromium with its Linux dependencies before running the browser checks through workerd.

Actions use reviewed full commit IDs. Pull request code runs through ordinary `pull_request` jobs with read access to repository contents. Checkout credentials are not retained, and checks receive no production secrets. New commits cancel earlier checks for the same pull request or branch. The job has a timeout.

Production deployment remains separate work governed by the [architecture delivery policy](../docs/specs/0001-architecture-environments/index.md). Fixture checks establish browser and Worker behavior. Database permissions, production configuration and live provider readiness need their own evidence.

_Drafted by /sync from the introducing change, worth a quick human pass._
