# Multiuser Hyper

Documents for turning Hyper into a multi-user, multi-agent platform for a team.

| File | What it is |
|---|---|
| [plan.md](plan.md) | **Start here.** Phased refactoring and migration plan (phases 0–8), order, rollback per phase |
| [switch.md](switch.md) | Step-by-step switch of the live Hyper to users (phase 1), with rollback point |
| [design.md](design.md) | Full design discussion: foundations (§0), access model, roles, compute, authority, identity, deployment, decisions §30–§35 |
| [research/](research/) | Background research: agent platforms, authorization models, agent security and isolation |

Status:

- Phase 1 (users and sign-in) is implemented on branch `multiuser-users`, rehearsed on a full copy
  of the live database, **not merged and not switched on**.
- Current scope is a trusted team: no isolation between users (design §32).
