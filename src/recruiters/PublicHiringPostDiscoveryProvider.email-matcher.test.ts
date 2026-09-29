import { recruiterEmailLocalPartMatchesName } from "./PublicHiringPostDiscoveryProvider";

describe("recruiterEmailLocalPartMatchesName", () => {
  test.each([
    "john.doe",
    "johndoe",
    "jdoe",
    "john_d",
    "j.doe",
    "john-d",
    "doej",
    "doe.j",
    "johnd",
    "john.d",
  ])("accepts John Doe -> %s", localPart => {
    expect(recruiterEmailLocalPartMatchesName("John Doe", localPart)).toBe(true);
  });

  test.each([
    ["John Michael Doe", "jmdoe"],
    ["John Michael Doe", "johndo"],
    ["José García", "josegarcia"],
    ["Amit Kumar Sharma", "aksharma"],
  ])("accepts common multi-part-name alias %s -> %s", (name, localPart) => {
    expect(recruiterEmailLocalPartMatchesName(name, localPart)).toBe(true);
  });

  test.each([
    ["John Doe", "jane.smith"],
    ["John Doe", "jd"],
    ["John Doe", "john"],
    ["John Doe", "doe"],
    ["John Doe", "hr"],
    ["John Doe", "careers"],
  ])("does not accept unrelated/ambiguous alias %s -> %s", (name, localPart) => {
    expect(recruiterEmailLocalPartMatchesName(name, localPart)).toBe(false);
  });

  test("ignores plus-addressing suffixes", () => {
    expect(recruiterEmailLocalPartMatchesName("John Doe", "john.doe+jobs")).toBe(true);
  });
});
