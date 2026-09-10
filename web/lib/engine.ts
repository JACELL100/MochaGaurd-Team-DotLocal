// Time-zone utility for the live leverage form. Risk calculations live exclusively in FastAPI.

const ET = "America/New_York";

function etOffset(date: string): string {
  const probe = new Date(`${date}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: ET, timeZoneName: "shortOffset" }).formatToParts(probe);
  const name = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT-4";
  const match = /GMT([+-]\d+)/.exec(name);
  const hours = match ? Number(match[1]) : -4;
  return `${hours < 0 ? "-" : "+"}${String(Math.abs(hours)).padStart(2, "0")}:00`;
}

export function etWallClock(date: string, hhmm: string): Date {
  return new Date(`${date}T${hhmm}:00${etOffset(date)}`);
}
