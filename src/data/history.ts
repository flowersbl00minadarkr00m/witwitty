export const formatEncounterDate = (encounteredAt: string): string => {
  const date = new Date(encounteredAt);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
};

export const formatRelativeEncounter = (encounteredAt: string, now = new Date()): string => {
  const encountered = new Date(encounteredAt);
  if (Number.isNaN(encountered.getTime())) return "Previously seen";
  const elapsed = Math.max(0, now.getTime() - encountered.getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatEncounterDate(encounteredAt);
};
