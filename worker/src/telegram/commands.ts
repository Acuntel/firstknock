const UNITS: Record<string, number> = {
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/** The longest pause we accept, so nobody mutes themselves indefinitely by typo. */
const MAX_PAUSE_DAYS = 90;

export interface PauseRequest {
  ok: boolean;
  until?: Date;
  /** Sentence sent straight back to the user, so it has to read well. */
  message: string;
}

/**
 * Parses the argument to /pause, as in "/pause 7d".
 *
 * Accepts hours, days, and weeks. A bare number is read as days, because that is
 * what someone typing "/pause 7" means, and guessing hours would silently
 * under-deliver on a vacation.
 */
export function parsePause(argument: string | undefined, now: Date): PauseRequest {
  const raw = (argument ?? "").trim().toLowerCase();
  if (raw.length === 0) {
    return {
      ok: false,
      message: "Tell me how long, as in /pause 7d. You can use hours, days, or weeks.",
    };
  }

  const match = /^(\d+)\s*([hdw]?)$/.exec(raw);
  if (!match) {
    return {
      ok: false,
      message: `I could not read "${argument}". Try /pause 7d, /pause 2w, or /pause 12h.`,
    };
  }

  const amount = Number(match[1]);
  const unit = match[2] === "" ? "d" : (match[2] as string);
  if (amount <= 0) {
    return { ok: false, message: "That has to be more than zero." };
  }

  const ms = amount * (UNITS[unit] as number);
  if (ms > MAX_PAUSE_DAYS * UNITS.d!) {
    return {
      ok: false,
      message: `That is longer than ${MAX_PAUSE_DAYS} days. Pick something shorter, or turn digests off in settings.`,
    };
  }

  const until = new Date(now.getTime() + ms);
  return {
    ok: true,
    until,
    message: `Digests and pings are paused until ${until.toISOString().slice(0, 10)}. Send /resume to start them again sooner.`,
  };
}

/** Pulls the payload out of "/start abc123" or a deep link start parameter. */
export function parseConnectCode(argument: string | undefined): string | null {
  const raw = (argument ?? "").trim();
  if (raw.length === 0) return null;
  // Codes are generated from a restricted alphabet, so anything else is noise.
  return /^[A-Za-z0-9_-]{6,64}$/.test(raw) ? raw : null;
}

/**
 * The command menu Telegram shows next to the message box.
 *
 * Without this a client has to already know the commands exist. Paul opening the
 * bot for the first time should see what it can do, not a blank chat. Registered
 * on bot startup so the menu cannot drift from the handlers.
 *
 * /start and /connect are deliberately absent. Both take a code nobody types by
 * hand, and listing them invites people to try.
 */
export const BOT_COMMANDS = [
  { command: "leads", description: "Today's top five" },
  { command: "pause", description: "Pause digests, as in /pause 7d" },
  { command: "resume", description: "Start digests again" },
  { command: "help", description: "What this bot can do" },
];

export const HELP_TEXT = [
  "FirstKnock commands:",
  "",
  "/leads shows today's top five.",
  "/pause 7d stops digests and pings for a week.",
  "/resume starts them again.",
  "/help shows this.",
  "",
  "To connect a group chat, add this bot to the group and send /connect with the code from your settings page.",
].join("\n");
