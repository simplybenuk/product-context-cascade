# Critique Mode

## Purpose

Critique mode turns the mole from a context store and output generator into a **context-grounded judgement tool**.

It should help a product person ask:
- is this idea actually good?
- what weakens this strategy?
- what in our context supports or undermines this roadmap?
- what assumptions are we smuggling into this spec?
- what would the strongest objection be?

This is not generic AI critique.
This is critique grounded in the actual cascade.

---

## Why it matters

A lot of product work is not just creating artefacts.
It is:
- pressure-testing ideas
- challenging assumptions
- surfacing conflicts
- identifying missing evidence
- strengthening decisions before commitment

That makes critique a natural companion to create/synthesise workflows.

---

## Core loop

A strong mole workflow should eventually support:

**capture → synthesise → create → critique → refine**

---

## Recommended command surface

Use `critique` as the primary verb.

Examples:
```bash
mole critique idea
mole critique strategy
mole critique roadmap
mole critique spec
mole critique decision-brief
```

## CLI behavior

The current CLI supports:

```bash
mole critique <target> [claim-or-path]
```

Supported targets are `idea`, `strategy`, `roadmap`, `spec`, and `decision-brief`. The optional second part can be a claim to test or a path to an existing artefact.

The command is intentionally thin. It prints an agent instruction that requires progressive retrieval, separates evidence from judgement, and uses the critique template when creating a file. It does not pretend that the CLI has performed the critique itself.

Chat/agent forms could also support:
- `/mole-critique-roadmap`
- `/mole-critique-spec`

---

## Inputs critique mode should accept

### 1. Idea or proposal
Examples:
- a raw product idea
- a strategic suggestion
- a prioritisation proposal

### 2. Existing artefact
Examples:
- roadmap draft
- spec draft
- strategy memo
- decision brief

### 3. Claim to test
Examples:
- “Collaborate should dominate our next two quarters”
- “We should deprioritise Red for now”
- “This feature is worth shipping now”

---

## How critique mode should work

### 1. Identify the object of critique
Work out whether the user is asking to critique:
- an idea
- a strategy
- a roadmap
- a spec
- a decision

### 2. Retrieve relevant context progressively
Start with:
- `0-bootstrap/`
- `1-routing/`
- relevant `2-summaries/`
- relevant `3-indexes/`

Descend to:
- `4-context/`
- `5-evidence/`

only as needed.

### 3. Separate supporting and weakening context
The output should clearly distinguish:
- what supports the idea
- what weakens it
- what assumptions it depends on
- what evidence is missing
- where conflicts exist

### 4. Produce a structured judgement
A good critique output should include:
- object of critique
- strongest supporting context
- strongest counterpoints
- assumptions
- risks
- missing evidence / missing human inputs
- judgement / confidence
- suggested refinement or next move

---

## Output pattern

Suggested output sections:

### Critique target
What is being tested?

### What supports it
Context or evidence that strengthens the case.

### What weakens it
Conflicts, missing evidence, competing priorities, risks.

### Assumptions
What has to be true for this to work?

### What is missing
What do we still need to know from humans, evidence, or data?

### Judgement
- likely strong
- plausible but weakly evidenced
- risky / under-supported
- not justified by current context

### Best next step
- refine
- validate
- re-scope
- deprioritise
- proceed

---

## Good use cases

- challenge a roadmap before sharing it
- pressure-test a strategy before socialising it
- critique a spec before implementation
- test whether an idea is supported by current product reality
- surface what would make a proposal stronger

---

## Recommendation

Critique mode should become a first-class capability of the mole.

It is one of the clearest ways to make the system useful for real product judgement rather than just document generation.
