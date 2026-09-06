import { getSolutions } from "./contentStore.js";

// Normalisation per Launch_Puzzle_Flow.json: uppercase, strip spaces/punctuation/hyphens.
function normalise(input) {
  return String(input || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function verifyCode(rawInput, session) {
  const normalised = normalise(rawInput);
  if (!normalised) {
    return { success: false, message: "NO ACCESS KEY ENTERED." };
  }

  const solutions = getSolutions();
  const match = solutions.codes.find((entry) =>
    entry.accepted_answers.some((ans) => normalise(ans) === normalised)
  );

  if (!match) {
    return {
      success: false,
      message: "ACCESS KEY REJECTED // THE ARCHIVE REMEMBERS A DIFFERENT ANSWER.",
    };
  }

  const prereqsMet = (match.requires || []).every((key) => session.unlocked[key]);
  if (!prereqsMet) {
    // Answer is technically valid but arrives out of order — still never a
    // hard lockout, just an in-world nudge back to the correct step.
    return {
      success: false,
      message: "THIS KEY DOES NOT MATCH THE CURRENT SESSION STATE.",
    };
  }

  session.unlocked[match.unlock_key] = true;
  return { success: true, message: match.response_message, unlock: match.unlock_key };
}

export { verifyCode, normalise };
