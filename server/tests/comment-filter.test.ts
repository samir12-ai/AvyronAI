/**
 * P-6.12 Phase 7 — unified acquisition comment filter unit tests.
 *
 * The filter is the single quality gate for comments from EVERY platform
 * actor (Instagram comment actor, TikTok, manual ingest). Design intent under
 * test:
 *  - short high-intent comments ("How much?") are NEVER dropped;
 *  - emoji-only / tag-only / very-short are kept but flagged LOW_SIGNAL;
 *  - owner replies are kept, classified authorType='owner' (audience evidence
 *    excludes them downstream at the data layer);
 *  - dedup is by platform comment ID only — identical text from different
 *    users is a real audience pattern;
 *  - rejects are counted per-reason (observable, never silent);
 *  - multilingual: meaningful-char logic is Unicode-aware (Arabic/Turkish).
 */
import { describe, it, expect } from "vitest";
import {
  evaluateComment,
  filterComments,
  emptyFilterStats,
  formatFilterStats,
  type FilterContext,
} from "../acquisition/comment-filter";

function ctx(overrides?: Partial<FilterContext>): FilterContext {
  return { ownerHandles: [], seenCommentIds: new Set<string>(), ...overrides };
}

function cand(text: string, id = "c1", username: string | null = "someuser") {
  return { commentId: id, username, text };
}

describe("evaluateComment — acceptance semantics", () => {
  it("normal substantive comment → ACCEPTED / OK / audience", () => {
    const d = evaluateComment(cand("The burger was amazing, best in Dubai"), ctx());
    expect(d).toEqual({ accepted: true, status: "ACCEPTED", reason: "OK", authorType: "audience" });
  });

  it("short intent questions are length-exempt (purchase intent is high signal)", () => {
    for (const text of ["How much?", "price?", "delivery??", "بكم", "fiyat ne kadar"]) {
      const d = evaluateComment(cand(text), ctx());
      expect(d.accepted).toBe(true);
      expect(d.reason).toBe("INTENT_QUESTION");
      expect(d.status).toBe("ACCEPTED");
    }
  });

  it("emoji-only → kept but ACCEPTED_LOW_SIGNAL / EMOJI_ONLY", () => {
    const d = evaluateComment(cand("🔥🔥😍"), ctx());
    expect(d.accepted).toBe(true);
    expect(d.status).toBe("ACCEPTED_LOW_SIGNAL");
    expect(d.reason).toBe("EMOJI_ONLY");
  });

  it("tag-only friend-tagging → kept as LOW_SIGNAL reach signal", () => {
    const d = evaluateComment(cand("@friend1 @friend.2"), ctx());
    expect(d.accepted).toBe(true);
    expect(d.status).toBe("ACCEPTED_LOW_SIGNAL");
    expect(d.reason).toBe("TAG_ONLY");
  });

  it("very short non-intent text ('ok') → kept as LOW_SIGNAL / VERY_SHORT", () => {
    const d = evaluateComment(cand("ok"), ctx());
    expect(d.accepted).toBe(true);
    expect(d.status).toBe("ACCEPTED_LOW_SIGNAL");
    expect(d.reason).toBe("VERY_SHORT");
  });

  it("Unicode scripts count as meaningful characters (Arabic not mis-flagged as short/empty)", () => {
    const d = evaluateComment(cand("الطعم رهيب والخدمة ممتازة"), ctx());
    expect(d.accepted).toBe(true);
    expect(d.reason).toBe("OK");
  });
});

describe("evaluateComment — rejection semantics", () => {
  it("empty / whitespace-only → REJECTED_EMPTY", () => {
    expect(evaluateComment(cand(""), ctx()).reason).toBe("REJECTED_EMPTY");
    expect(evaluateComment(cand("   "), ctx()).reason).toBe("REJECTED_EMPTY");
  });

  it("duplicate platform comment ID → REJECTED_DUPLICATE_ID", () => {
    const c = ctx({ seenCommentIds: new Set(["dup-1"]) });
    const d = evaluateComment(cand("great food", "dup-1"), c);
    expect(d.accepted).toBe(false);
    expect(d.reason).toBe("REJECTED_DUPLICATE_ID");
  });

  it("same TEXT from different users is NOT deduped (real audience pattern)", () => {
    const c = ctx();
    const first = evaluateComment(cand("How much?", "id-1", "user1"), c);
    c.seenCommentIds.add("id-1");
    const second = evaluateComment(cand("How much?", "id-2", "user2"), c);
    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
  });

  it("bot spam signatures → REJECTED_BOT_SPAM (even when long)", () => {
    for (const text of [
      "follow me for follow back guys",
      "check my page for amazing content you will love it",
      "I can help you grow your account fast",
    ]) {
      expect(evaluateComment(cand(text), ctx()).reason).toBe("REJECTED_BOT_SPAM");
    }
  });

  it("promo/link spam → REJECTED_PROMO_SPAM", () => {
    for (const text of ["visit https://spam.example now", "deal on wa.me/12345", "click the link here"]) {
      expect(evaluateComment(cand(text), ctx()).reason).toBe("REJECTED_PROMO_SPAM");
    }
  });

  it("keyboard mashing (one char repeated) → REJECTED_REPEATED_CHARS", () => {
    const d = evaluateComment(cand("aaaaaaaa"), ctx());
    expect(d.accepted).toBe(false);
    expect(d.reason).toBe("REJECTED_REPEATED_CHARS");
  });
});

describe("evaluateComment — owner classification", () => {
  it("owner reply → kept, authorType='owner', ACCEPTED_OWNER_REPLY", () => {
    const c = ctx({ ownerHandles: ["MaxziBurger"] });
    const d = evaluateComment(cand("Thanks for visiting!", "c9", "maxziburger"), c);
    expect(d.accepted).toBe(true);
    expect(d.authorType).toBe("owner");
    expect(d.status).toBe("ACCEPTED_OWNER_REPLY");
    expect(d.reason).toBe("OWNER_REPLY");
  });

  it("owner match is case-insensitive and @-prefix-insensitive", () => {
    const c = ctx({ ownerHandles: ["@Maxzi.Burger"] });
    expect(evaluateComment(cand("hi", "c1", "MAXZI.BURGER"), c).authorType).toBe("owner");
  });

  it("missing username → authorType='unknown', still evaluated on merits", () => {
    const d = evaluateComment(cand("Best fries in town, coming back", "c2", null), ctx());
    expect(d.authorType).toBe("unknown");
    expect(d.accepted).toBe(true);
  });

  it("owner spam-looking reply is still classified owner (kept as competitive signal)", () => {
    const c = ctx({ ownerHandles: ["brand"] });
    const d = evaluateComment(cand("check my page link in bio", "c3", "brand"), c);
    expect(d.accepted).toBe(true);
    expect(d.status).toBe("ACCEPTED_OWNER_REPLY");
  });
});

describe("filterComments — batch accounting", () => {
  it("stats reconcile: evaluated = accepted + rejected; every reason counted", () => {
    const { accepted, stats } = filterComments(
      [
        cand("The burger was amazing", "a1"),
        cand("How much?", "a2"),
        cand("🔥🔥", "a3"),
        cand("follow me for follow", "a4"),
        cand("", "a5"),
        cand("dup text", "a1"), // duplicate ID of a1 (accepted → seeded in-batch)
      ],
      ctx(),
    );
    expect(stats.evaluated).toBe(6);
    expect(stats.accepted + stats.rejected).toBe(stats.evaluated);
    expect(accepted.length).toBe(stats.accepted);
    expect(stats.byReason["OK"]).toBe(1);
    expect(stats.byReason["INTENT_QUESTION"]).toBe(1);
    expect(stats.byReason["EMOJI_ONLY"]).toBe(1);
    expect(stats.byReason["REJECTED_BOT_SPAM"]).toBe(1);
    expect(stats.byReason["REJECTED_EMPTY"]).toBe(1);
    expect(stats.byReason["REJECTED_DUPLICATE_ID"]).toBe(1);
  });

  it("in-batch dedup: accepted IDs are added to seenCommentIds; DB-seeded IDs rejected up front", () => {
    const c = ctx({ seenCommentIds: new Set(["db-persisted"]) });
    const { accepted, stats } = filterComments(
      [cand("nice one", "db-persisted"), cand("fresh comment here", "new-1"), cand("second copy", "new-1")],
      c,
    );
    expect(accepted.map((a) => a.comment.commentId)).toEqual(["new-1"]);
    expect(stats.byReason["REJECTED_DUPLICATE_ID"]).toBe(2);
    expect(c.seenCommentIds.has("new-1")).toBe(true);
  });

  it("owner/lowSignal sub-counters track their statuses", () => {
    const c = ctx({ ownerHandles: ["brand"] });
    const { stats } = filterComments(
      [cand("thanks!", "o1", "brand"), cand("😍", "l1"), cand("ok", "l2")],
      c,
    );
    expect(stats.acceptedOwner).toBe(1);
    expect(stats.acceptedLowSignal).toBe(2);
  });

  it("generic type passthrough: extra fields survive filtering untouched", () => {
    const rich = { commentId: "r1", username: "u", text: "Great atmosphere and service", likes: 7, postId: "p1" };
    const { accepted } = filterComments([rich], ctx());
    expect(accepted[0].comment.likes).toBe(7);
    expect(accepted[0].comment.postId).toBe("p1");
  });
});

describe("stats helpers", () => {
  it("emptyFilterStats returns all-zero accounting", () => {
    expect(emptyFilterStats()).toEqual({
      evaluated: 0,
      accepted: 0,
      acceptedOwner: 0,
      acceptedLowSignal: 0,
      rejected: 0,
      byReason: {},
    });
  });

  it("formatFilterStats renders a grep-able one-liner with per-reason counts", () => {
    const { stats } = filterComments([cand("How much?", "f1"), cand("", "f2")], ctx());
    const line = formatFilterStats(stats);
    expect(line).toContain("evaluated=2");
    expect(line).toContain("accepted=1");
    expect(line).toContain("rejected=1");
    expect(line).toContain("INTENT_QUESTION=1");
    expect(line).toContain("REJECTED_EMPTY=1");
  });
});
