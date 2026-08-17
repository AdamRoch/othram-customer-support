# Real Zendesk instance, simulated Case System

This is a demo deliverable for Othram, built locally with no access to their production systems. We integrate against a **real Zendesk account** owned by the developer (trial tier) because "proper use of Zendesk APIs" is an explicit evaluation criterion — a mock would undercut that. The **Case System is simulated**: a local, seeded service behind an interface, since Othram's real case management system is inaccessible. If this ever goes live, only the Case System adapter changes; the Zendesk integration carries over unchanged.

## Considered Options

- Mock both Zendesk and the Case System — rejected: weakens the Zendesk integration story, which is graded.
- Live integration with Othram's systems — rejected: not available for a challenger project.
