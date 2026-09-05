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

  test("recognizes positive messages", () => {
    expect(
      classifier.classify({ subject: "Next steps", bodyText: "Your profile has been shortlisted." })
    ).toBe("POSITIVE");
  });

  test("does not invent a classification", () => {
    expect(
      classifier.classify({ subject: "Team update", bodyText: "Thanks for reaching out." })
    ).toBe("OTHER");
  });
});
