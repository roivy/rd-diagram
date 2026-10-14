# Security Policy

## Supported versions

The latest `main` branch and the most recent release are supported.

## Reporting a vulnerability

Please report vulnerabilities privately via
[GitHub security advisories](https://github.com/roivy/rd-flowchart/security/advisories/new).
Do not open public issues for security problems. You should receive a
response within a few days.

## Design posture

- Generated artifacts are fully offline: the viewer runtime makes **no
  network calls** and loads no external resources.
- The engine itself never fetches at runtime; update checks are permanently
  disabled in this fork's distribution path.
- All rendering is local and deterministic — no diagram content leaves the
  machine it was generated on.
