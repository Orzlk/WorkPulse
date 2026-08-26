# TODO

## Release readiness for 0.0.1

- [x] Keep GitHub online update checks and installation disabled until the release process is finalized.
- [x] Add the full test suite to the GitHub release workflow before packaging.
- [ ] Run a manual desktop smoke test for first launch, Flomo image import, log editing, Kanban, report generation, and data transfer.
- [ ] Validate platform installer artifacts with `npm run dist:win`, `npm run dist:mac`, and `npm run dist:linux` in their respective environments.
- [ ] Decide whether the consolidated v1 database reset policy is acceptable for any existing users before publishing.
