export function applyLocalRiskDecision({ classification, verifiedOwner, existingFailClosed }) {
  if (verifiedOwner === true) {
    return {
      outcome: "ALLOW",
      classification,
      ownerOverride: true
    };
  }
  return {
    outcome: existingFailClosed ? "FAIL_CLOSED" : "ALLOW",
    classification,
    ownerOverride: false
  };
}
