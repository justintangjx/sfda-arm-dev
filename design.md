# Coach interface design

Source: the approved [coach interface specification](docs/specs/0004-coach-interface-foundation/index.md).

## Character

You get a calm workspace with warm neutral surfaces, dark text and restrained green actions. System fonts and the SFDA Coaches text wordmark keep the interface focused on your work. There are no portraits, remote fonts or decorative images.

## Build mandate

Every screen keeps your campaign, competition, stage and player reference clear. Feedback forms have persistent labels, supporting text and explicit actions. Saving a draft and submitting feedback remain separate. History preserves original feedback beside corrections.

## Composition

The shared header contains the wordmark and current coach. Preview has a visible sample data banner. Campaigns appear as cards with team, competition, stage and access context. Desktop places the player roster beside the workspace. Below 960 pixels, you move from the roster to the player and return through Back to roster.

Write feedback and History share one editor. Loading never shows another player's previous text. Empty, unavailable, error and offline states explain what you can do next. Dialogs begin with the safe choice and return focus when dismissed.

## Tokens

Visual values live in [tokens.css](src/app/styles/tokens.css). Shared native control styles live in [styles.css](src/app/styles.css). Coach composition uses [coach.module.css](src/app/coach/coach.module.css). The specification governs these values.

## Accessibility and evidence

You can use labelled controls with a keyboard, visible focus and status announcements. Text wraps on narrow screens and supports enlargement. The target is WCAG 2.2 AA. Automated checks do not establish actual screen reader or device results.

The foundation uses explicit synthetic preview data. Real Auth, database permissions and live voice require evidence from their owning features.
