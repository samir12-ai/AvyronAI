---
name: JSON-text DB columns crash string-intolerant readers
description: strategy_roots-style tables store JSON fields as text; a reader that assumes parsed shapes crashes with ".map is not a function" the FIRST time a column goes non-null. Normalize at the load site with type-appropriate fallbacks.
---

# Rule
Tables that persist JSON as text (e.g. strategy_roots approved* columns) will pass every test until a column first becomes non-null in production — then any consumer that assumes arrays/objects crashes (`.map is not a function`).

**Why:** plan synthesis crashed on `approvedObjections.map` during the first real run where objections were persisted; other consumers survived because they parse per-site.

**How to apply:**
- Normalize once at the module's load site (right after the DB read), NOT globally — other consumers may be string-tolerant and double-parsing breaks them.
- On JSON.parse failure, return the field's TYPE-APPROPRIATE default ([] for array fields, null for object fields) with a warning log — returning the raw string just moves the `.map` crash downstream.
- Alias legacy/renamed keys at the same normalization point.
