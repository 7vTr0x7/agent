import { assessJobRisk } from "./JobRiskPolicy";

describe("assessJobRisk", () => {
  test("keeps ordinary job descriptions low risk", () => {
    expect(
      assessJobRisk({
        title: "Frontend Engineer",
        companyName: "Example Company",
        description: "Build React applications and collaborate with product and design."
      })
    ).toMatchObject({ level: "LOW", score: 0 });
  });

  test("blocks explicit candidate payment requests", () => {
    expect(
      assessJobRisk({
        title: "Remote Developer",
        companyName: "Example Company",
        description: "Candidates must pay a registration fee before the interview."
      })
    ).toMatchObject({ level: "HIGH", score: 100 });
  });

  test("blocks gift-card and crypto payment scams", () => {
    expect(
      assessJobRisk({
        title: "Software Engineer",
        companyName: "Example Company",
        description: "We will reimburse you with gift cards after you send a crypto payment."
      })
    ).toMatchObject({ level: "HIGH", score: 100 });
  });

  test("flags messaging-app-only recruitment without blocking it", () => {
    expect(
      assessJobRisk({
        title: "Developer",
        companyName: "Example Company",
        description: "Contact only via Telegram to proceed."
      })
    ).toMatchObject({ level: "MEDIUM", score: 35 });
  });

  test("does not reject normal equipment language", () => {
    expect(
      assessJobRisk({
        title: "Frontend Engineer",
        companyName: "Example Company",
        description: "The company provides a laptop and development equipment."
      })
    ).toMatchObject({ level: "LOW", score: 0 });
  });
});
