import request from "supertest";
import { describe, expect, it } from "vitest";
import { createReportApp } from "../src/app.js";
import type { VerdictCardData } from "../src/card.js";

const dangerVerdict: VerdictCardData = {
  aspect: "DANGER",
  subjectShortHash: "ab12cd34",
  flags: [
    { code: "UNVERIFIED_CONTRACT", message: "Contract bytecode has not been verified on-chain" }
  ],
  notChecked: ["Liquidity lock"],
  decisionTxHash: "4".repeat(64),
  policyHash: "5".repeat(64)
};

describe("/feed routes", () => {
  it("(a) POST /feed/share with optIn:false → 403 share_not_opted_in and GET /feed stays empty", async () => {
    const app = createReportApp();

    // First store a card to get a valid cardId
    const postCard = await request(app)
      .post("/card")
      .send(dangerVerdict)
      .expect(200);
    const cardId = postCard.body.id as string;

    // Attempt share with optIn false
    const shareRes = await request(app)
      .post("/feed/share")
      .send({ cardId, optIn: false })
      .expect(403);

    expect(shareRes.body).toMatchObject({ error: "share_not_opted_in" });

    // Feed stays empty
    const feedRes = await request(app).get("/feed").expect(200);
    expect(feedRes.body.entries).toEqual([]);
  });

  it("(b) POST /card then POST /feed/share {cardId, optIn:true} → ok, and GET /feed returns that entry", async () => {
    const app = createReportApp();

    // Store a card
    const postCard = await request(app)
      .post("/card")
      .send(dangerVerdict)
      .expect(200);
    const cardId = postCard.body.id as string;

    // Share with opt-in
    const shareRes = await request(app)
      .post("/feed/share")
      .send({ cardId, optIn: true })
      .expect(200);

    expect(shareRes.body).toMatchObject({ ok: true });

    // Feed returns the entry
    const feedRes = await request(app).get("/feed").expect(200);
    expect(feedRes.body.entries).toHaveLength(1);
    expect(feedRes.body.entries[0]).toMatchObject({
      id: cardId,
      aspect: dangerVerdict.aspect,
      subjectShortHash: dangerVerdict.subjectShortHash,
      cardImageUrl: `/card/${cardId}.png`
    });
  });

  it("(c) POST /feed/share with unknown cardId + optIn:true → 404", async () => {
    const app = createReportApp();

    const shareRes = await request(app)
      .post("/feed/share")
      .send({ cardId: "nonexistent-card-id", optIn: true })
      .expect(404);

    expect(shareRes.body).toMatchObject({ error: "unknown_card" });
  });

  it("POST /feed/share is idempotent — sharing same cardId twice yields one entry", async () => {
    const app = createReportApp();

    // store a card
    const storeRes = await request(app)
      .post("/card")
      .send(dangerVerdict)
      .expect(200);
    const { id } = storeRes.body as { id: string };

    // share once
    await request(app).post("/feed/share").send({ cardId: id, optIn: true }).expect(200);
    // share again
    await request(app).post("/feed/share").send({ cardId: id, optIn: true }).expect(200);

    // feed should have exactly one entry for this cardId
    const feedRes = await request(app).get("/feed").expect(200);
    expect(feedRes.body.entries.filter((e: { id: string }) => e.id === id)).toHaveLength(1);
  });

  it("GET /feed returns entries most-recent-first by insertion order", async () => {
    const app = createReportApp();

    const firstVerdict: VerdictCardData = {
      ...dangerVerdict,
      subjectShortHash: "aaaa1111"
    };
    const secondVerdict: VerdictCardData = {
      ...dangerVerdict,
      subjectShortHash: "bbbb2222"
    };

    const first = await request(app).post("/card").send(firstVerdict).expect(200);
    const second = await request(app).post("/card").send(secondVerdict).expect(200);

    await request(app)
      .post("/feed/share")
      .send({ cardId: first.body.id, optIn: true })
      .expect(200);

    await request(app)
      .post("/feed/share")
      .send({ cardId: second.body.id, optIn: true })
      .expect(200);

    const feedRes = await request(app).get("/feed").expect(200);
    expect(feedRes.body.entries).toHaveLength(2);
    // Most-recent-first: second was inserted after first
    expect(feedRes.body.entries[0].subjectShortHash).toBe("bbbb2222");
    expect(feedRes.body.entries[1].subjectShortHash).toBe("aaaa1111");
  });
});
