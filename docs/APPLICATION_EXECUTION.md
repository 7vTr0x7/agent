# Application execution

The application pipeline now treats an ATS application as a bounded, safety-gated state machine rather than a single-page submit.

## Flow

1. Resolve the job's unambiguous Apply entry point.
2. Refuse authentication/account-creation pages; credentials are never automated.
3. Detect and fill the current application page using the candidate profile.
4. Re-run the safety gate on every page.
5. Advance through unique `Next`/`Continue`/`Review` controls for at most eight steps.
6. Support explicit standardized answers for policy-sensitive fields such as sponsorship, work authorization, notice period, and experience.
7. Verify a unique visible/enabled final submit control.
8. Reserve the application atomically before the final submission.
9. Persist the confirmed submission only after the adapter reports success.

Unknown, ambiguous, unsupported, or authentication-dependent fields remain fail-closed. This is intentional: a 100% reliable automation system must not invent candidate answers or credentials.
