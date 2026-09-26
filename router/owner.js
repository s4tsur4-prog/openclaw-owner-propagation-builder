import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function writePrivateJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporary, filePath);
}

export function canonicalOwnerIdentity(ctx, event) {
  void event;
  const channel = String(ctx?.channel || ctx?.messageProvider || "")
    .trim()
    .toLowerCase();
  const accountId = String(ctx?.accountId || "").trim();
  const senderId = String(ctx?.senderId || "").trim();
  if (!channel || !accountId || !senderId) {
    return null;
  }
  return `${channel}\u0000${accountId}\u0000${senderId}`;
}

export function ownerIdentityHash(identity) {
  if (!identity) {
    return null;
  }
  return `sha256:${crypto.createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

export function readOwnerStore(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return { version: 1, owners: Array.isArray(value?.owners) ? value.owners : [] };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { version: 1, owners: [] };
    }
    throw error;
  }
}

export function recordTrustedOwner(filePath, ctx, event) {
  if (ctx?.senderIsOwner !== true) {
    return false;
  }
  const hash = ownerIdentityHash(canonicalOwnerIdentity(ctx, event));
  if (!hash) {
    return false;
  }
  const store = readOwnerStore(filePath);
  if (!store.owners.includes(hash)) {
    store.owners.push(hash);
    store.owners.sort();
    writePrivateJson(filePath, store);
  }
  return true;
}

// The persistent store is an audit binding only, never an authority source.
export function isTrustedOwner(_filePath, ctx, _event) {
  return ctx?.senderIsOwner === true;
}
