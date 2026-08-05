import type { Investigation } from "./types";

export const mockCase: Investigation = {
  id: "black-hawk-down",
  film: "BLACK HAWK DOWN",
  curiosity: "I want to understand why everything went wrong.",
  intent:
    "Trace how a short capture mission became an extended urban battle—and separate immediate mistakes from the deeper assumptions that made the plan fragile.",
  currentTrail: "THE FAILURE CASCADE",
  evidence: [
    {
      id: "ev-book",
      index: "01",
      shortLabel: "Bowden · ch. 3",
      type: "BOOK",
      locator: "Chapter 3 · exact pages require edition verification",
      whySurfaced: "Establishes the intended mission rhythm and the assumptions attached to speed.",
      status: "MOCK",
      url: "https://en.wikipedia.org/wiki/Black_Hawk_Down_(book)",
    },
    {
      id: "ev-report",
      index: "02",
      shortLabel: "After-action record",
      type: "OFFICIAL RECORD",
      locator: "Section and page resolver pending",
      whySurfaced: "Provides the formal operational sequence to compare with participant accounts.",
      status: "MOCK",
      url: "https://en.wikipedia.org/wiki/Battle_of_Mogadishu_(1993)",
    },
    {
      id: "ev-interview",
      index: "03",
      shortLabel: "Participant oral history",
      type: "VIDEO INTERVIEW",
      locator: "18:42–21:13 · demonstration locator",
      whySurfaced: "Shows how the timing felt from inside the operation rather than from the later official chronology.",
      status: "MOCK",
      url: "https://www.youtube.com/results?search_query=Battle+of+Mogadishu+veteran+interview",
    },
  ],
  beats: [
    {
      id: "beat-01",
      type: "opening",
      kicker: "THE FIRST ASSUMPTION",
      body: "It was not planned as a battle.",
      evidenceIds: ["ev-book"],
    },
    {
      id: "beat-02",
      type: "context",
      body:
        "The operation depended on compression: reach the targets quickly, hold the perimeter briefly, load the detainees, and leave before the city could reorganize around the raid.",
      evidenceIds: ["ev-book", "ev-report"],
    },
    {
      id: "beat-03",
      type: "question",
      body: "So what had to remain true for speed to protect the plan?",
      prompt: "Hold the question. The answer is distributed across the next three pieces of evidence.",
      evidenceIds: [],
    },
    {
      id: "beat-04",
      type: "evidence",
      kicker: "DEPENDENCY 01",
      body:
        "The air element had to insert and extract without turning the aircraft into fixed obligations over hostile streets.",
      evidenceIds: ["ev-report", "ev-interview"],
    },
    {
      id: "beat-05",
      type: "turn",
      body: "Then the mission changed category.",
      evidenceIds: [],
    },
    {
      id: "beat-06",
      type: "contradiction",
      kicker: "TWO ACCOUNTS",
      body:
        "The official chronology can make the sequence appear legible. Participant accounts describe information arriving late, unevenly, and through a chain that was already under pressure.",
      evidenceIds: ["ev-report", "ev-interview"],
    },
    {
      id: "beat-07",
      type: "connection",
      body:
        "The question may not be whether one component failed. It may be why the plan had so little room for several ordinary failures to coexist.",
      prompt: "Create a note here, or ask the investigator to challenge this interpretation.",
      evidenceIds: ["ev-book", "ev-report", "ev-interview"],
    },
    {
      id: "beat-08",
      type: "lead",
      kicker: "WHERE NEXT?",
      body: "Follow the tactical cascade, the political constraints, or the Somali perspective.",
      prompt: "Give the investigator a direction in your own words to open a new branch.",
      evidenceIds: [],
    },
    {
      id: "beat-09",
      type: "resolution",
      body: "You have not reached an answer. You have found the shape of the question.",
      evidenceIds: [],
    },
  ],
};
