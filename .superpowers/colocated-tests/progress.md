# Colocated tests correction

Approved in conversation, bounded correction of existing tests layout; no new product behavior. Branch refactor/modular-architecture, all earlier implementation preserved uncommitted.

Three disjoint worker domains: /root/colocated_infrastructure, /root/colocated_application, /root/colocated_interfaces. Controller owns architecture guards and documentation. Context.md defines ownership and constraints.

RED: tests/architecture/test-layout.test.ts initially 2pass/5fail (missing sibling enforcement, runtime schema classification, test/production boundaries, test-import-test prohibition). After helper implementation real-tree gate correctly listed missing sibling suites. Bootstrap exemption regression 0pass/1fail before narrowing.
GREEN interim: all41architecture tests passed after current additions, 62assertions. Every current file with behavior now has its sibling. Puretypes/static/reexports exempt, rootcli exemption checked exact ASTbootstrap shape and removed if ownlogic added.

Preservation: check.ts compares every original production file byteforbyte against before.json and original named testcases. One approved semantic split: original Unicode/summary/search combined test mapped to three owner-specific tests, controller manually compared exact boundary/summary/search expected assertions. No removed behavior.

Ownership adjustment: OpenCode generated plugin integration belongs modules/assistants/__tests__, interfacesworker moves there, appworker notified. No production edits needed.

Pending: workers final reports, fullsuite isolatedPostgres/install/PTY, independent review, finalhandoff evidence.

Workers complete: application63pass/293assertions; infrastructure169pass/813assertions (plus refinedconfigurationownership39pass); interfaces89pass/658assertions. All reports available; production bytes unchanged, all baseline namedcases preserved with documented split.
Controller fullsuite: FORGE614_TEST_POSTGRES_BIN=/tmp/engram-postgres-17.6.tTVxxc/postgres/bin bun test => 370pass/0fail,1886assertions,70files,34.21s,exit0. Typecheck/diffcheck exit0. Actual PG/install/PTY executed. 46 behavior-bearing sourcefiles each have own siblingtest (plus publicSDK barrel contract test).
Independentreview /root/colocated_review pending on before--after.diff. No commits/staging/push.
Review findings: Important guard omitted computed top-level expressions; Minor templates generation/idempotency duplicated by new own-file case and preserved original integration suite. No production/safety blockers.
Guard fix RED: computed runtime expression fixture returned [] incorrectly (0pass/1fail). Fix explicitly classifies only pure types/reexports/static declarations as exempt; runtime initializers/controlflow require sibling. GREEN architecture42pass/69assertions; typecheck/diff exit0. Applicationworker consolidates duplicate templates cases, preserving originals.
Review fix1: templates consolidation approved. Scoped reviewer found destructuring default/computed-key calls bypassed static-initializer guard; RED fixture reproduced. Identifier-only binding exemption fixed it, GREEN9testlayoutcases/20assertions, typecheck/diffexit0. Scoped fix2 /root/colocated_review PASS, both reviewfindings resolved, no newissues.
Original plugin/quoting cases now directly in templates.test.ts; redundant integration suite and duplicate new wrappers removed without losing originalbehavior. Final controller fullsuite running after allfixes.
COMPLETE: final controller fullsuite369pass/0fail/1891assertions,69files,33.49s with actualdisposablePG/install/PTY, no skips. Final log /tmp/engram-colocated-final.log. Typecheck/diffcheckgreen. Independent review and scopedfixreviews PASS. Originalproductionbytes unchanged and baselinecasesretained/documentedsplit. Handoff prompt/spec/plan adenda reflect colocatedtests. No docs/es/en/Notion edits; no commits/staging/push; same branch/currentcheckout.
