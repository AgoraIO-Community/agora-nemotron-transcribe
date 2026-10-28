import type { Transcript, Word } from "./contracts";
function srtTime(seconds: number) {
  const milliseconds = Math.round(seconds * 1000);
  return `${Math.floor(milliseconds / 3600000)
    .toString()
    .padStart(2, "0")}:${Math.floor((milliseconds / 60000) % 60)
    .toString()
    .padStart(2, "0")}:${Math.floor((milliseconds / 1000) % 60)
    .toString()
    .padStart(2, "0")},${(milliseconds % 1000).toString().padStart(3, "0")}`;
}
export function toSrt(words: Word[]) {
  const groups: Word[][] = [];
  for (const word of words) {
    const group = groups.at(-1);
    if (
      !group ||
      group.length >= 8 ||
      group[0].speaker !== word.speaker ||
      word.end - group[0].start > 4
    )
      groups.push([word]);
    else group.push(word);
  }
  return groups
    .map(
      (group, index) =>
        `${index + 1}\n${srtTime(group[0].start)} --> ${srtTime(group.at(-1)!.end)}\n${group[0].speaker ? `[${group[0].speaker}] ` : ""}${group.map((word) => word.word).join(" ")}\n`,
    )
    .join("\n");
}
export function exportTranscript(
  result: Transcript,
  type: "txt" | "json" | "srt",
) {
  return type === "json"
    ? JSON.stringify(result, null, 2)
    : type === "srt"
      ? toSrt(result.words)
      : result.text;
}
