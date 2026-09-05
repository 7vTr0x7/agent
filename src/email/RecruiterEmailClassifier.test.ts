import { RecruiterEmailClassifier } from "./RecruiterEmailClassifier";

describe("RecruiterEmailClassifier", () => {
  const classifier = new RecruiterEmailClassifier();

  test("recognizes interview messages", () => {
    expect(
      classifier.classify({ subject: "Interview invitation", bodyText: "Please choose a time for your technical round." })
    ).toBe("INTERVIEW");
  });

  test("recognizes rejection messages", () => {
    expect(
      classifier.classify({ subject: "Update on your application", bodyText: "Unfortunately, we will not be moving forward." })
    ).toBe("REJECTION");
  });

  test("rejection wins when a rejection message also contains moving-forward language", () => {
    expect(
      classifier.classify({
        subject: "Application update",
        bodyText: "We will not be moving forward with your application at this time."
      })
    ).toBe("REJECTION");
  });

  test("recognizes positive messages", () => {
    expect(
      classifier.classify({ subject: "Next steps", bodyText: "Your profile has been shortlisted." })
    ).toBe("POSITIVE");
  });

  test("recognizes common rejection variants", () => {
    const messages = [
      "We have decided not to proceed with your application.",
      "The position has been filled.",
      "We regret to inform you that you were not selected.",
      "We are unable to move forward at this stage."
    ];

    for (const bodyText of messages) {
      expect(classifier.classify({ subject: "Application update", bodyText })).toBe("REJECTION");
    }
  });

  test("does not invent a classification", () => {
    expect(
      classifier.classify({ subject: "Team update", bodyText: "Thanks for reaching out." })
    ).toBe("OTHER");
  });
});
