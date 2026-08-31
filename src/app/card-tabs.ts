/** Person-card content tabs. View-only — never writes OKF or settings. */

export const CARD_SECTIONS = ["about", "photos", "files", "timeline", "commitments", "relations"] as const;

export type CardSection = (typeof CARD_SECTIONS)[number];

export const CARD_SECTION_LABELS: Record<CardSection, string> = {
  about: "About",
  photos: "Photos",
  files: "Files",
  timeline: "Timeline",
  commitments: "Commitments",
  relations: "Relations",
};

export function isCardSection(value: string): value is CardSection {
  return (CARD_SECTIONS as readonly string[]).includes(value);
}

/** Arrow / Home / End move across the tab strip. Other keys leave the selection alone. */
export function nextCardSection(current: CardSection, key: string): CardSection | null {
  const index = CARD_SECTIONS.indexOf(current);
  if (index < 0) return null;
  const last = CARD_SECTIONS.length - 1;
  if (key === "ArrowRight" || key === "ArrowDown") {
    return CARD_SECTIONS[index === last ? 0 : index + 1];
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return CARD_SECTIONS[index === 0 ? last : index - 1];
  }
  if (key === "Home") return CARD_SECTIONS[0];
  if (key === "End") return CARD_SECTIONS[last];
  return null;
}

export function cardTabId(section: CardSection): string {
  return `card-tab-${section}`;
}

export function cardPanelId(section: CardSection): string {
  return `card-panel-${section}`;
}
